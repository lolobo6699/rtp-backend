// 個人用戶統計資料來源（新 API 尚未提供，接上時只需改這個檔案）
// 輸出統一格式：{ project, username, lottery, lotteryCode, sales, payout, rebate, profit, winRate, rtp }
const { ProxyAgent, fetch: proxyFetch } = require('undici');
const { describeError } = require('./errors');

class SourceNotConfigured extends Error {}

function isMock() {
    return process.env.USER_STATS_MOCK === '1';
}

function isConfigured() {
    return isMock() || !!process.env.USER_STATS_API_URL;
}

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[,%]/g, ''));
    return isNaN(n) ? null : n;
}

// 補齊缺少的欄位：盈虧 = 派獎 + 返點 − 銷量；RTP = (派獎 + 返點) / 銷量
function normalize(r) {
    const sales  = num(r.sales)  ?? 0;
    const payout = num(r.payout) ?? 0;
    const rebate = num(r.rebate) ?? 0;
    const profit = num(r.profit) ?? (payout + rebate - sales);
    const rtp    = num(r.rtp)    ?? (sales > 0 ? (payout + rebate) / sales : null);
    return {
        project:     String(r.project || ''),
        username:    String(r.username || ''),
        lottery:     String(r.lottery || '').trim(),
        lotteryCode: r.lotteryCode != null ? String(r.lotteryCode) : '',
        sales, payout, rebate, profit,
        winRate:     num(r.winRate),
        rtp,
    };
}

// 本機測試用假資料（只有設 USER_STATS_MOCK=1 才會用到）
function mockRows() {
    return [
        { project: 'TEST_A', username: 'demo001', lottery: '奇趣腾讯分分彩', lotteryCode: '000', sales: 1000000, payout: 1350000, rebate: 0, winRate: 30 },
        { project: 'TEST_B', username: 'demo002', lottery: '奇趣腾讯分分彩', lotteryCode: '000', sales: 500000,  payout: 950000,  rebate: 0, winRate: 50 },
        { project: 'TEST_A', username: 'demo003', lottery: '奇趣腾讯分分彩', lotteryCode: '000', sales: 800000,  payout: 850000,  rebate: 0, winRate: 20 },
        { project: 'TEST_B', username: 'demo004', lottery: '哈希分分彩',     lotteryCode: '001', sales: 300000,  payout: 690000,  rebate: 0, winRate: 41.2 },
    ];
}

// params：{ lotteryClass, lotteries: [...], dateStart, dateEnd }
async function fetchUserStats(params) {
    if (isMock()) {
        return mockRows().map(normalize).filter(r => params.lotteries.includes(r.lottery));
    }
    const url = process.env.USER_STATS_API_URL;
    if (!url) throw new SourceNotConfigured('個人統計資料來源尚未設定（缺 USER_STATS_API_URL）');

    // 以下請求與欄位對應為暫定，新 API 規格確定後再調整
    const proxyUrl = process.env.PROXY_URL;
    const options = {
        method:  'POST',
        headers: { 'X-Api-Key': process.env.USER_STATS_API_KEY || '', 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
        signal:  AbortSignal.timeout(30000),
    };
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    try {
        let res;
        try {
            res = dispatcher ? await proxyFetch(url, { ...options, dispatcher }) : await fetch(url, options);
        } catch (err) {
            throw new Error(`個人統計 API 連線失敗：${describeError(err)}`);
        }
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (_) {
            throw new Error(`個人統計 API 回傳非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(`個人統計 API HTTP ${res.status}：${text.slice(0, 200)}`);
        return (data.rows || []).map(normalize);
    } finally {
        if (dispatcher) dispatcher.close().catch(() => {});
    }
}

module.exports = { fetchUserStats, isConfigured, SourceNotConfigured };
