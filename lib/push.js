const { ProxyAgent, fetch: proxyFetch } = require('undici');
const pool = require('./db');

const TARGET_LOTTERY = '奇趣腾讯分分彩';
const THRESHOLD      = 0.012;

const MERCHANTS = [
    { name:'XO',  maxBonus:0.988 },
    { name:'XH',  maxBonus:0.989 },
    { name:'LS',  maxBonus:0.991 },
    { name:'OL',  maxBonus:0.990 },
    { name:'XY',  maxBonus:0.994 },
    { name:'FB',  maxBonus:0.988 },
    { name:'MT',  maxBonus:0.992 },
    { name:'JD',  maxBonus:0.990 },
    { name:'ND',  maxBonus:0.999 },
    { name:'YD',  maxBonus:0.998 },
    { name:'SH',  maxBonus:0.988 },
    { name:'YS',  maxBonus:0.989 },
    { name:'JY',  maxBonus:0.994 },
    { name:'HS',  maxBonus:0.999 },
    { name:'RF',  maxBonus:0.999 },
    { name:'TD',  maxBonus:0.998 },
    { name:'DS',  maxBonus:0.999 },
];

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
    const { year, month, day, hour } = getTaiwanDate();
    const hourKey = `${year}-${month}-${day}-${hour}`;

    // 防重複：先搶先得
    try {
        const result = await pool.query(
            'INSERT INTO rtp_push_log (hour_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING hour_key',
            [hourKey]
        );
        if (result.rows.length === 0) {
            return { ok: true, skipped: true, reason: '本小時已推播' };
        }
    } catch (_) {
        // DB 失敗不阻擋，繼續執行
    }

    const { dateStart, dateEnd } = getDateRange();
    const platforms = MERCHANTS.map(m => m.name);
    const statsApi  = process.env.STATS_API_URL;
    const apiKey    = process.env.STATS_API_KEY;
    const proxyUrl  = process.env.PROXY_URL;

    const fetchOptions = {
        method:  'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platforms, lotteryType: TARGET_LOTTERY, dateStart, dateEnd }),
        signal:  AbortSignal.timeout(50000),
    };

    let response;
    if (proxyUrl) {
        const dispatcher = new ProxyAgent(proxyUrl);
        response = await proxyFetch(`${statsApi}/api/v1/lottery-stats`, { ...fetchOptions, dispatcher });
    } else {
        response = await fetch(`${statsApi}/api/v1/lottery-stats`, fetchOptions);
    }

    const data = await response.json();

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

    // 推 TG
    const tgRes = await fetch(
        `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
        {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text: msg }),
        }
    );
    const tgData = await tgRes.json();

    return { ok: true, alerts: alertRows.length, tg: tgData.ok };
}

module.exports = { runPush };
