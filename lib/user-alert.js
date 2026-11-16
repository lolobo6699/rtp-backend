// 個人異常推播：某用戶在某彩種 RTP ≥ 門檻 且 遊戲盈虧 ≥ 門檻 → 推 TG
const pool = require('./db');
const { fetchUserStats, isConfigured, SourceNotConfigured } = require('./user-source');
const { sendBlocks } = require('./tg');

// 彩類／彩種選項（暫定，新 API 接上後改為 API 提供的清單）
const LOTTERY_OPTIONS = {
    '時時彩': ['奇趣腾讯分分彩', '哈希分分彩'],
};
const DATE_MODES = { today: '今日', yesterday: '昨日', week: '本週', month: '當月' };

const DEFAULT_CONFIG = {
    enabled:      false,
    lotteryClass: '時時彩',
    lotteries:    ['奇趣腾讯分分彩'],
    dateMode:     'today',
    rtpMin:       null,
    profitMin:    null,
};

async function getConfig() {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'user_alert'");
    if (!r.rows[0]) return { ...DEFAULT_CONFIG };
    try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(r.rows[0].value) };
    } catch (_) {
        return { ...DEFAULT_CONFIG };
    }
}

function toNumOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : NaN;
}

// 回傳 { config } 或 { error }
function validateConfig(input) {
    const c = input || {};
    const lotteryClass = String(c.lotteryClass || '');
    if (!LOTTERY_OPTIONS[lotteryClass]) return { error: '彩類不正確' };
    const lotteries = Array.isArray(c.lotteries) ? [...new Set(c.lotteries.map(String))] : [];
    if (lotteries.some(l => !LOTTERY_OPTIONS[lotteryClass].includes(l))) return { error: '彩種不屬於所選彩類' };
    const dateMode = String(c.dateMode || '');
    if (!DATE_MODES[dateMode]) return { error: '日期選項不正確' };
    const rtpMin = toNumOrNull(c.rtpMin);
    if (Number.isNaN(rtpMin) || (rtpMin !== null && rtpMin <= 0)) return { error: 'RTP 門檻需為大於 0 的數字' };
    const profitMin = toNumOrNull(c.profitMin);
    if (Number.isNaN(profitMin) || (profitMin !== null && profitMin < 0)) return { error: '盈虧門檻需為 0 以上的數字' };
    const enabled = c.enabled === true;
    if (enabled) {
        if (lotteries.length === 0) return { error: '啟用前請至少選一個彩種' };
        if (rtpMin === null || profitMin === null) return { error: '啟用前請填寫 RTP 門檻與盈虧門檻' };
    }
    return { config: { enabled, lotteryClass, lotteries, dateMode, rtpMin, profitMin } };
}

async function saveConfig(config) {
    await pool.query(
        "INSERT INTO settings (key, value) VALUES ('user_alert', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [JSON.stringify(config)]
    );
}

// 台灣時間
function taiwanNow() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
function ymd(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getDateRange(mode, now = taiwanNow()) {
    const day = 24 * 60 * 60 * 1000;
    const today = ymd(now);
    if (mode === 'yesterday') {
        const y = ymd(new Date(now.getTime() - day));
        return { dateStart: y, dateEnd: y };
    }
    if (mode === 'week') {
        const sinceMonday = (now.getUTCDay() + 6) % 7; // 週一為一週開始
        return { dateStart: ymd(new Date(now.getTime() - sinceMonday * day)), dateEnd: today };
    }
    if (mode === 'month') return { dateStart: today.slice(0, 8) + '01', dateEnd: today };
    return { dateStart: today, dateEnd: today };
}

// 抓資料並篩出超標的用戶
async function findAlerts(config) {
    const { dateStart, dateEnd } = getDateRange(config.dateMode);
    const rows = await fetchUserStats({
        lotteryClass: config.lotteryClass,
        lotteries:    config.lotteries,
        dateStart, dateEnd,
    });
    const alerts = rows
        .filter(r => config.lotteries.includes(r.lottery))
        .filter(r => r.rtp !== null && r.rtp >= config.rtpMin && r.profit >= config.profitMin)
        .sort((a, b) => b.profit - a.profit);
    return { dateStart, dateEnd, total: rows.length, alerts };
}

function fmt(n) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatBlock(r, dateStart, dateEnd) {
    const range = dateStart === dateEnd ? dateStart : `${dateStart}~${dateEnd}`;
    const lines = [
        '【个人彩种盈亏异常通知】',
        `异常专案：${r.project}`,
        `结算时间：${range}`,
        `彩种代号：${r.lottery}${r.lotteryCode ? `(${r.lotteryCode})` : ''}`,
        `用户名称：${r.username}`,
        `个人该彩种原始销量：${fmt(r.sales)}`,
        `个人该彩种派奖：${fmt(r.payout)}`,
        `个人该彩种返点：${fmt(r.rebate)}`,
        `个人游戏盈亏：${fmt(r.profit)}`,
    ];
    if (r.winRate !== null) lines.push(`中奖率：${r.winRate.toFixed(3)}%`);
    lines.push(`RTP：${r.rtp.toFixed(3)}`);
    return lines.join('\n');
}

function hourKey() {
    const d = taiwanNow();
    return `user-${ymd(d)}-${String(d.getUTCHours()).padStart(2, '0')}`;
}

// 排程呼叫：未啟用或資料來源未設定 → 跳過（不算失敗）
async function runUserAlert() {
    const config = await getConfig();
    if (!config.enabled) return { ok: true, skipped: true, reason: '個人異常推播未啟用' };
    if (!isConfigured()) return { ok: true, skipped: true, reason: '個人統計資料來源尚未設定' };

    const key = hourKey();
    const claim = await pool.query(
        'INSERT INTO rtp_push_log (hour_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING hour_key', [key]
    );
    if (claim.rows.length === 0) return { ok: true, skipped: true, reason: '本小時已推播' };

    try {
        const { dateStart, dateEnd, total, alerts } = await findAlerts(config);
        console.log(`[userAlert] ${dateStart}~${dateEnd} 用戶資料 ${total} 筆，超標 ${alerts.length} 筆`);
        if (alerts.length === 0) return { ok: true, alerts: 0 };
        const messages = await sendBlocks(alerts.map(r => formatBlock(r, dateStart, dateEnd)));
        return { ok: true, alerts: alerts.length, messages };
    } catch (err) {
        await pool.query('DELETE FROM rtp_push_log WHERE hour_key = $1', [key]).catch(() => {});
        throw err;
    }
}

module.exports = {
    LOTTERY_OPTIONS, DATE_MODES,
    getConfig, validateConfig, saveConfig,
    getDateRange, findAlerts, formatBlock, runUserAlert,
    isConfigured, SourceNotConfigured, sendBlocks,
};
