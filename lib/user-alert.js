// 個人異常推播：某用戶在某彩種 RTP ≥ 門檻 且 遊戲盈虧 ≥ 門檻 → 推 TG
const pool = require('./db');
const { fetchUserStats, isConfigured, keyInfo, SourceNotConfigured } = require('./user-source');
const { sendBlocks } = require('./tg');

const DEFAULT_LOTTERIES = ['奇趣腾讯分分彩', '哈希分分彩'];
const EXCLUDED_PLATFORMS = ['XO']; // XO 後台不支援一次查全部會員
const DATE_MODES = { today: '今日', yesterday: '昨日', week: '本週', month: '當月' };

const DEFAULT_CONFIG = {
    enabled:   false,
    lotteries: ['奇趣腾讯分分彩'],
    dateMode:  'today',
    rtpMin:    null,
    profitMin: null,
};

async function readJsonSetting(key) {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    if (!r.rows[0]) return null;
    try { return JSON.parse(r.rows[0].value); } catch (_) { return null; }
}
async function writeJsonSetting(key, value) {
    await pool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, JSON.stringify(value)]
    );
}

async function getConfig() {
    const saved = await readJsonSetting('user_alert');
    const c = { ...DEFAULT_CONFIG, ...(saved || {}) };
    delete c.lotteryClass; // 舊版欄位
    return c;
}

// 彩種選項：預設清單 ＋ 查詢時看過的彩種
async function getLotteryOptions() {
    const saved = await readJsonSetting('user_lottery_options');
    return [...new Set([...DEFAULT_LOTTERIES, ...(Array.isArray(saved) ? saved : [])])];
}
async function addLotteryOptions(names) {
    const cur = await getLotteryOptions();
    const merged = [...new Set([...cur, ...names.filter(Boolean)])];
    if (merged.length !== cur.length) await writeJsonSetting('user_lottery_options', merged);
    return merged;
}

async function getPlatforms() {
    const r = await pool.query('SELECT name FROM merchants WHERE active = true ORDER BY name');
    return r.rows.map(x => x.name).filter(n => !EXCLUDED_PLATFORMS.includes(n));
}

function toNumOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : NaN;
}

// 回傳 { config } 或 { error }
function validateConfig(input) {
    const c = input || {};
    const lotteries = Array.isArray(c.lotteries)
        ? [...new Set(c.lotteries.map(s => String(s).trim()).filter(Boolean))]
        : [];
    if (lotteries.some(l => l.length > 50)) return { error: '彩種名稱太長' };
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
    return { config: { enabled, lotteries, dateMode, rtpMin, profitMin } };
}

async function saveConfig(config) {
    await writeJsonSetting('user_alert', config);
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

// 抓資料並篩出超標的用戶（盈虧門檻同時交給 API 先過濾，減少資料量）
async function findAlerts(config) {
    const { dateStart, dateEnd } = getDateRange(config.dateMode);
    const platforms = await getPlatforms();
    const { rows, failed } = await fetchUserStats({ platforms, dateStart, dateEnd, profitMin: config.profitMin });
    await addLotteryOptions(rows.map(r => r.lottery)).catch(err => console.error('[userAlert] 更新彩種清單失敗:', err.message));
    const alerts = rows
        .filter(r => config.lotteries.includes(r.lottery))
        .filter(r => r.rtp !== null && r.rtp >= config.rtpMin && r.profit >= config.profitMin)
        .sort((a, b) => b.profit - a.profit);
    return { dateStart, dateEnd, total: rows.length, alerts, failed };
}

// 手動更新彩種清單：查最近 7 天全部資料，收集出現過的彩種（API 沒有彩種清單功能）
const REFRESH_DAYS = 7;
async function refreshLotteryOptions() {
    const now = taiwanNow();
    const dateStart = ymd(new Date(now.getTime() - (REFRESH_DAYS - 1) * 24 * 60 * 60 * 1000));
    const dateEnd = ymd(now);
    const platforms = await getPlatforms();
    const { rows, failed } = await fetchUserStats({ platforms, dateStart, dateEnd });
    const options = await addLotteryOptions(rows.map(r => r.lottery));
    return { options, failed };
}

function fmt(n) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatBlock(r, dateStart, dateEnd) {
    const range = dateStart === dateEnd ? dateStart : `${dateStart}~${dateEnd}`;
    const lines = [
        '【个人彩种盈亏异常通知】',
        `异常专案：${r.platform}`,
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

function formatFailed(failed) {
    return '⚠ 以下平台查询失败，未纳入：' +
        failed.map(f => f.error ? `${f.platform}（${f.error.slice(0, 60)}）` : f.platform).join('、');
}

function buildBlocks({ alerts, failed, dateStart, dateEnd }) {
    const blocks = alerts.map(r => formatBlock(r, dateStart, dateEnd));
    if (failed.length) blocks.push(formatFailed(failed));
    return blocks;
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
        const result = await findAlerts(config);
        const { dateStart, dateEnd, total, alerts, failed } = result;
        console.log(`[userAlert] ${dateStart}~${dateEnd} 資料 ${total} 筆，超標 ${alerts.length} 筆` +
            (failed.length ? `，失敗平台：${failed.map(f => f.platform).join(',')}` : ''));
        const blocks = buildBlocks(result);
        if (blocks.length === 0) return { ok: true, alerts: 0 };
        const messages = await sendBlocks(blocks);
        return { ok: true, alerts: alerts.length, failedPlatforms: failed.map(f => f.platform), messages };
    } catch (err) {
        await pool.query('DELETE FROM rtp_push_log WHERE hour_key = $1', [key]).catch(() => {});
        throw err;
    }
}

module.exports = {
    DATE_MODES,
    getConfig, validateConfig, saveConfig, getLotteryOptions, refreshLotteryOptions,
    getDateRange, findAlerts, formatBlock, buildBlocks, runUserAlert,
    isConfigured, keyInfo, SourceNotConfigured, sendBlocks,
};
