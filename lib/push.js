const { ProxyAgent, fetch: proxyFetch } = require('undici');
const pool = require('./db');
const { describeError } = require('./errors');

const TARGET_LOTTERY = '奇趣腾讯分分彩';
const DEFAULT_THRESHOLD = 0.012;

async function getThreshold() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'threshold'");
        const v = parseFloat(result.rows[0]?.value);
        if (!isNaN(v) && v > 0 && v < 1) return v;
    } catch (err) {
        console.error('[getThreshold] DB 錯誤，改用預設 0.012:', err.message);
    }
    return DEFAULT_THRESHOLD;
}

async function getMerchants() {
    try {
        const result = await pool.query(
            'SELECT name, max_bonus AS "maxBonus" FROM merchants WHERE active = true ORDER BY name'
        );
        console.log('[getMerchants] 商戶數:', result.rows.length);
        return result.rows;
    } catch (err) {
        throw new Error(`資料庫讀取商戶失敗：${describeError(err)}`);
    }
}

const STATS_ATTEMPTS      = 3;
const STATS_RETRY_DELAY   = 20000;
const STATS_TIMEOUT       = 30000;

async function fetchStatsOnce({ statsApi, apiKey, proxyUrl, body }) {
    const options = {
        method:  'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(STATS_TIMEOUT),
    };
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    try {
        let response;
        try {
            response = dispatcher
                ? await proxyFetch(`${statsApi}/api/v1/lottery-stats`, { ...options, dispatcher })
                : await fetch(`${statsApi}/api/v1/lottery-stats`, options);
        } catch (err) {
            throw new Error(`統計 API 連線失敗（${proxyUrl ? '經代理' : '直連'}）：${describeError(err)}`);
        }

        let text;
        try {
            text = await response.text();
        } catch (err) {
            throw new Error(`統計 API 讀取回應失敗：${describeError(err)}`);
        }
        if (response.status === 401 || response.status === 403) {
            const e = new Error(`統計 API HTTP ${response.status}（金鑰或權限問題，重試無效）：${text.slice(0, 200)}`);
            e.noRetry = true;
            throw e;
        }
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            throw new Error(`統計 API 回傳非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
        }
        if (!response.ok) throw new Error(`統計 API HTTP ${response.status}：${text.slice(0, 200)}`);
        return data;
    } finally {
        if (dispatcher) dispatcher.close().catch(() => {});
    }
}

async function fetchStatsWithRetry(params) {
    let lastErr;
    for (let i = 1; i <= STATS_ATTEMPTS; i++) {
        try {
            const data = await fetchStatsOnce(params);
            if (i > 1) console.log(`[doPush] 第 ${i} 次抓統計成功`);
            return data;
        } catch (err) {
            lastErr = err;
            console.error(`[doPush] 第 ${i}/${STATS_ATTEMPTS} 次抓統計失敗：${err.message}`);
            if (err.noRetry || i === STATS_ATTEMPTS) break;
            await new Promise(r => setTimeout(r, STATS_RETRY_DELAY));
        }
    }
    throw lastErr;
}

function parseNum(v) {
    if (v == null) return 0;
    return parseFloat(String(v).replace(/,/g, '')) || 0;
}

function getTaiwanDate() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return {
        year:   now.getUTCFullYear(),
        month:  String(now.getUTCMonth() + 1).padStart(2, '0'),
        day:    String(now.getUTCDate()).padStart(2, '0'),
        hour:   String(now.getUTCHours()).padStart(2, '0'),
        minute: String(now.getUTCMinutes()).padStart(2, '0'),
    };
}

function getDateRange() {
    const { year, month, day } = getTaiwanDate();
    return {
        dateStart: `${year}-${month}-01`,
        dateEnd:   `${year}-${month}-${day}`,
    };
}

async function runPush() {
    const MERCHANTS = await getMerchants();
    if (MERCHANTS.length === 0) return { ok: false, reason: '商戶清單為空' };

    const { year, month, day, hour } = getTaiwanDate();
    const hourKey = `${year}-${month}-${day}-${hour}`;

    // 防重複：先搶先得
    let claimed = false;
    try {
        const result = await pool.query(
            'INSERT INTO rtp_push_log (hour_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING hour_key',
            [hourKey]
        );
        if (result.rows.length === 0) {
            return { ok: true, skipped: true, reason: '本小時已推播' };
        }
        claimed = true;
    } catch (err) {
        console.error('[dedup] DB 錯誤，仍繼續推播:', err.message);
    }

    try {
        return await doPush(MERCHANTS, { year, month, day, hour });
    } catch (err) {
        // 推播失敗就把本小時記錄撤掉，手動 Run now 才能重推
        if (claimed) {
            await pool.query('DELETE FROM rtp_push_log WHERE hour_key = $1', [hourKey]).catch(() => {});
        }
        throw err;
    }
}

async function doPush(MERCHANTS, { year, month, day, hour }) {
    const THRESHOLD = await getThreshold();
    console.log('[doPush] 門檻:', THRESHOLD);
    const { dateStart, dateEnd } = getDateRange();
    const platforms = MERCHANTS.map(m => m.name);
    const statsApi  = process.env.STATS_API_URL;
    const apiKey    = process.env.STATS_API_KEY;
    const proxyUrl  = process.env.PROXY_URL;

    const body = JSON.stringify({ platforms, lotteryType: TARGET_LOTTERY, dateStart, dateEnd });
    const data = await fetchStatsWithRetry({ statsApi, apiKey, proxyUrl, body });

    // 依平台彙整
    const statMap = {};
    for (const row of (data.rows || [])) {
        const p           = row['平台'];
        const lotteryName = (row['彩种'] || '').trim();
        if (lotteryName !== TARGET_LOTTERY) continue;
        if (!statMap[p]) statMap[p] = { rtp: null, bonus: 0, bet: 0, rebate: 0 };
        if (row['RTP'] != null) statMap[p].rtp = parseNum(row['RTP']);
        statMap[p].bonus  += parseNum(row['奖金']);
        statMap[p].bet    += parseNum(row['销量'] ?? row['投注金额']);
        statMap[p].rebate += parseNum(row['返点']);
    }

    // 計算各商戶 RTP
    const alertRows = [];
    for (const m of MERCHANTS) {
        const s = statMap[m.name];
        if (!s) continue;
        const rtp  = s.rtp !== null ? s.rtp : (s.bet > 0 ? (s.bonus + s.rebate) / s.bet : null);
        if (rtp === null) continue;
        const diff = m.maxBonus - rtp;
        if (diff < THRESHOLD) {
            alertRows.push({ name: m.name, maxBonus: m.maxBonus, rtp, diff, raw: s });
        }
    }

    // 組 TG 訊息
    const { minute } = getTaiwanDate();
    const timeStr = `${year}-${month}-${day} ${hour}:${minute}`;
    let msg = '';
    if (alertRows.length === 0) {
        msg = `✅ ${timeStr}\n全部商戶 RTP 正常，無異常。`;
    } else {
        msg = `⚠️ RTP 異常通知\n時間：${timeStr}\n`;
        for (const r of alertRows) {
            msg += `\n平台：${r.name}\n`;
            msg += `投注金额：${r.raw.bet.toFixed(2)}\n`;
            msg += `奖金：${r.raw.bonus.toFixed(2)}\n`;
            msg += `返点：${r.raw.rebate.toFixed(2)}\n`;
            msg += `RTP：${r.rtp.toFixed(3)}\n`;
            msg += `低於觀察RTP：${r.diff.toFixed(3)}\n`;
        }
    }

    // 推 TG（錯誤訊息遮掉 Token，避免寫進 log）
    const hideToken = s => process.env.TG_TOKEN ? s.split(process.env.TG_TOKEN).join('***') : s;
    let tgRes, tgText;
    try {
        tgRes = await fetch(
            `${process.env.TG_API_URL || 'https://api.telegram.org'}/bot${process.env.TG_TOKEN}/sendMessage`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text: msg }),
                signal:  AbortSignal.timeout(20000),
            }
        );
        tgText = await tgRes.text();
    } catch (err) {
        throw new Error(`TG 連線失敗：${hideToken(describeError(err))}`);
    }
    let tgData;
    try {
        tgData = JSON.parse(tgText);
    } catch (_) {
        throw new Error(`TG 回傳非 JSON（HTTP ${tgRes.status}）：${hideToken(tgText.slice(0, 200))}`);
    }
    if (!tgData.ok) throw new Error(`TG 推播失敗：${tgData.description || '未知原因'}`);

    return { ok: true, alerts: alertRows.length, tg: tgData.ok };
}

module.exports = { runPush };
