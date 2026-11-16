// 個人用戶統計資料來源：統計站「用户彩种分析查询」API（POST /api/v1/user-lottery-analysis）
// 預設沿用平台統計的 STATS_API_URL / STATS_API_KEY / PROXY_URL；可用 USER_STATS_API_URL / USER_STATS_API_KEY 覆寫
// 輸出：{ rows: [{ platform, username, lottery, lotteryCode, sales, payout, rebate, profit, winRate, rtp }], failed: [{ platform, error }] }
const { ProxyAgent, fetch: proxyFetch } = require('undici');
const { describeError } = require('./errors');

const PATH    = '/api/v1/user-lottery-analysis';
const TIMEOUT = 120000; // 即時向各平台後台查詢，平台多時較慢

class SourceNotConfigured extends Error {}

function isMock() {
    return process.env.USER_STATS_MOCK === '1';
}

function endpoint() {
    if (process.env.USER_STATS_API_URL) return process.env.USER_STATS_API_URL;
    if (process.env.STATS_API_URL) return process.env.STATS_API_URL.replace(/\/+$/, '') + PATH;
    return '';
}

// 去掉前後空白、換行與引號（貼上時常多帶）
function clean(v) {
    return String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

// 目前使用的金鑰：優先 USER_STATS_API_KEY，沒有才用 STATS_API_KEY
function apiKey() {
    const own = clean(process.env.USER_STATS_API_KEY);
    if (own) return { key: own, source: 'USER_STATS_API_KEY' };
    const shared = clean(process.env.STATS_API_KEY);
    return { key: shared, source: shared ? 'STATS_API_KEY' : '' };
}

// 給後台看的診斷資訊（不含金鑰內容）
function keyInfo() {
    const raw = process.env.USER_STATS_API_KEY;
    const { key, source } = apiKey();
    return {
        source: source || '未設定',
        length: key.length,
        cleaned: raw != null && source === 'USER_STATS_API_KEY' && raw !== key, // 原值有多餘空白或引號
    };
}

function isConfigured() {
    return isMock() || !!endpoint();
}

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[,%]/g, ''));
    return isNaN(n) ? null : n;
}

// 「哈希分分彩(370)」→ 名稱「哈希分分彩」、代號「370」
function splitLottery(s) {
    const m = String(s || '').trim().match(/^(.*?)\s*[(（]\s*([^()（）]+)\s*[)）]$/);
    return m ? { name: m[1].trim(), code: m[2].trim() } : { name: String(s || '').trim(), code: '' };
}

function normalize(row) {
    const { name, code } = splitLottery(row['彩种']);
    const sales  = num(row['投注金额']) ?? 0;
    const payout = num(row['奖金']) ?? 0;
    const rebate = num(row['返点']) ?? 0;
    const profit = num(row['盈亏']) ?? (payout + rebate - sales);
    const rtp    = num(row['RTP']) ?? (sales > 0 ? payout / sales : null); // 與統計站相同：奖金 ÷ 投注金额
    return {
        platform: String(row['平台'] || ''),
        username: String(row['帐号'] || ''),
        lottery:  name,
        lotteryCode: code,
        sales, payout, rebate, profit,
        winRate:  num(row['中奖率']),
        rtp,
    };
}

function parseResponse(data, platforms) {
    if (!data || data.ok === false) throw new Error(`個人統計 API 回傳錯誤：${(data && data.error) || '未知原因'}`);
    const errMap = new Map((data.errors || []).map(e => [String(e.platform), String(e.error || '')]));
    for (const p of data.failedPlatforms || []) if (!errMap.has(String(p))) errMap.set(String(p), '');
    const failed = [...errMap].map(([platform, error]) => ({ platform, error }));
    if (failed.length > 0 && failed.length >= platforms.length) {
        throw new Error(`個人統計 API 全部平台查詢失敗：${failed.map(f => `${f.platform} ${f.error}`.trim()).join('；').slice(0, 300)}`);
    }
    const rows = (data.rows || []).filter(r => r['帐号'] && r['帐号'] !== 'system').map(normalize);
    return { rows, failed };
}

// 本機測試用假回應（只有設 USER_STATS_MOCK=1 才會用到；格式同真 API）
function mockResponse(platforms) {
    const p = platforms;
    return {
        ok: true,
        rows: [
            { '平台': p[0] || 'T1', '帐号': 'demo001', '彩种': '奇趣腾讯分分彩(000)', '投注金额': 1000000, '奖金': 1350000, '返点': 0, '盈亏': 350000, '中奖率': '30.00%', 'RTP': 1.35 },
            { '平台': p[1] || 'T2', '帐号': 'demo002', '彩种': '奇趣腾讯分分彩(000)', '投注金额': 500000,  '奖金': 950000,  '返点': 0, '盈亏': 450000, '中奖率': '50.00%', 'RTP': 1.9 },
            { '平台': p[0] || 'T1', '帐号': 'demo003', '彩种': '奇趣腾讯分分彩(000)', '投注金额': 800000,  '奖金': 850000,  '返点': 0, '盈亏': 50000,  '中奖率': '20.00%', 'RTP': 1.063 },
            { '平台': p[1] || 'T2', '帐号': 'demo004', '彩种': '哈希分分彩(001)',     '投注金额': 300000,  '奖金': 690000,  '返点': 0, '盈亏': 390000 },
        ],
        errors: p.length > 2 ? [{ platform: p[2], error: '后台登入失效（假资料）' }] : [],
    };
}

// params：{ platforms: [...], dateStart, dateEnd, profitMin? }
async function fetchUserStats({ platforms, dateStart, dateEnd, profitMin, timeout = TIMEOUT }) {
    if (!platforms || platforms.length === 0) throw new Error('沒有可查詢的平台（商戶清單為空）');
    if (isMock()) return parseResponse(mockResponse(platforms), platforms);

    const url = endpoint();
    if (!url) throw new SourceNotConfigured('個人統計資料來源尚未設定（缺 STATS_API_URL）');

    const body = { platforms, dateStart, dateEnd, account: '', byPlayType: false };
    if (profitMin != null) body.profitMin = profitMin;

    const proxyUrl = process.env.PROXY_URL;
    const options = {
        method:   'POST',
        headers:  { 'X-Api-Key': apiKey().key, 'Content-Type': 'application/json' },
        body:     JSON.stringify(body),
        redirect: 'manual', // IP 不在白名單時會 302 導走，不要跟過去
        signal:   AbortSignal.timeout(timeout),
    };
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    try {
        let res;
        try {
            res = dispatcher ? await proxyFetch(url, { ...options, dispatcher }) : await fetch(url, options);
        } catch (err) {
            throw new Error(`個人統計 API 連線失敗（${proxyUrl ? '經代理' : '直連'}）：${describeError(err)}`);
        }
        if (res.status >= 300 && res.status < 400) {
            throw new Error(`個人統計 API HTTP ${res.status}：來源 IP 不在統計站白名單`);
        }
        let text;
        try {
            text = await res.text();
        } catch (err) {
            throw new Error(`個人統計 API 讀取回應失敗：${describeError(err)}`);
        }
        if (res.status === 401) {
            const k = keyInfo();
            throw new Error(`個人統計 API HTTP 401：API 金鑰錯誤或缺少（使用 ${k.source}，長度 ${k.length}）`);
        }
        let data;
        try { data = JSON.parse(text); } catch (_) {
            throw new Error(`個人統計 API 回傳非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(`個人統計 API HTTP ${res.status}：${(data && data.error) || text.slice(0, 200)}`);
        return parseResponse(data, platforms);
    } finally {
        if (dispatcher) dispatcher.close().catch(() => {});
    }
}

module.exports = { fetchUserStats, isConfigured, keyInfo, SourceNotConfigured, splitLottery };
