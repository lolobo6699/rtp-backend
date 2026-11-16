// 個人用戶統計資料來源：統計站「用户彩种分析查询」API（POST /api/v1/user-lottery-analysis）
// 預設沿用平台統計的 STATS_API_URL / STATS_API_KEY / PROXY_URL；可用 USER_STATS_API_URL / USER_STATS_API_KEY 覆寫
// 輸出：{ rows: [{ platform, username, lottery, lotteryCode, sales, payout, rebate, profit, winRate, rtp }], failed: [{ platform, error }] }
const { ProxyAgent, fetch: proxyFetch } = require('undici');
const { describeError } = require('./errors');

const PATH    = '/api/v1/user-lottery-analysis';
// API 即時向各平台後台查詢，一次查多個平台會超過統計站前 Cloudflare 的 100 秒上限（HTTP 524），
// 所以一個平台查一次，最多同時 3 個（文件要求不要同時開太多查詢）
const PER_PLATFORM_TIMEOUT = 90000;
const CONCURRENCY = 3;

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

function parseResponse(data) {
    if (!data || data.ok === false) throw new Error(`個人統計 API 回傳錯誤：${(data && data.error) || '未知原因'}`);
    const errMap = new Map((data.errors || []).map(e => [String(e.platform), String(e.error || '')]));
    for (const p of data.failedPlatforms || []) if (!errMap.has(String(p))) errMap.set(String(p), '');
    const failed = [...errMap].map(([platform, error]) => ({ platform, error }));
    const rows = (data.rows || []).filter(r => r['帐号'] && r['帐号'] !== 'system').map(normalize);
    return { rows, failed };
}

// 匯總後檢查：全部平台都失敗才算整體失敗
function finish(platforms, rows, failed) {
    if (failed.length > 0 && new Set(failed.map(f => f.platform)).size >= platforms.length) {
        throw new Error(`個人統計 API 全部平台查詢失敗：${failed.map(f => `${f.platform} ${f.error}`.trim()).join('；').slice(0, 300)}`);
    }
    return { rows, failed };
}

// 這類錯誤換平台查也一樣會失敗，直接整體中止
class FatalError extends Error {}

// 非 JSON 回應（例如 Cloudflare 錯誤頁）只留重點，不要把整頁 HTML 寫進訊息
function shortBody(status, text) {
    if (status === 524) return '統計站處理逾時（Cloudflare 524）';
    if (/^\s*</.test(text)) {
        const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1];
        return `回傳網頁而非資料${title ? `：${title.trim().slice(0, 80)}` : ''}`;
    }
    return text.slice(0, 200);
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

// 查單一平台
async function fetchOne(url, platform, { dateStart, dateEnd, profitMin }) {
    const body = { platforms: [platform], dateStart, dateEnd, account: '', byPlayType: false };
    if (profitMin != null) body.profitMin = profitMin;

    const proxyUrl = process.env.PROXY_URL;
    const options = {
        method:   'POST',
        headers:  { 'X-Api-Key': apiKey().key, 'Content-Type': 'application/json' },
        body:     JSON.stringify(body),
        redirect: 'manual', // IP 不在白名單時會 302 導走，不要跟過去
        signal:   AbortSignal.timeout(PER_PLATFORM_TIMEOUT),
    };
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    try {
        let res;
        try {
            res = dispatcher ? await proxyFetch(url, { ...options, dispatcher }) : await fetch(url, options);
        } catch (err) {
            throw new Error(`連線失敗（${proxyUrl ? '經代理' : '直連'}）：${describeError(err)}`);
        }
        if (res.status >= 300 && res.status < 400) {
            throw new FatalError(`個人統計 API HTTP ${res.status}：來源 IP 不在統計站白名單`);
        }
        let text;
        try {
            text = await res.text();
        } catch (err) {
            throw new Error(`讀取回應失敗：${describeError(err)}`);
        }
        if (res.status === 401) {
            const k = keyInfo();
            throw new FatalError(`個人統計 API HTTP 401：API 金鑰錯誤或缺少（使用 ${k.source}，長度 ${k.length}）`);
        }
        let data;
        try { data = JSON.parse(text); } catch (_) {
            throw new Error(`HTTP ${res.status}，${shortBody(res.status, text)}`);
        }
        if (res.status === 400) throw new FatalError(`個人統計 API HTTP 400：${(data && data.error) || text.slice(0, 200)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}：${(data && data.error) || text.slice(0, 200)}`);
        return parseResponse(data);
    } finally {
        if (dispatcher) dispatcher.close().catch(() => {});
    }
}

// params：{ platforms: [...], dateStart, dateEnd, profitMin? }
async function fetchUserStats({ platforms, dateStart, dateEnd, profitMin }) {
    if (!platforms || platforms.length === 0) throw new Error('沒有可查詢的平台（商戶清單為空）');
    if (isMock()) {
        const { rows, failed } = parseResponse(mockResponse(platforms));
        return finish(platforms, rows, failed);
    }

    const url = endpoint();
    if (!url) throw new SourceNotConfigured('個人統計資料來源尚未設定（缺 STATS_API_URL）');

    const rows = [], failed = [], timing = [];
    let fatal = null;
    const queue = [...platforms];
    async function worker() {
        while (queue.length && !fatal) {
            const p = queue.shift();
            const t0 = Date.now();
            try {
                const r = await fetchOne(url, p, { dateStart, dateEnd, profitMin });
                rows.push(...r.rows);
                failed.push(...r.failed);
                timing.push(`${p} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            } catch (err) {
                if (err instanceof FatalError) { fatal = err; return; }
                failed.push({ platform: p, error: err.message });
                timing.push(`${p} 失敗 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, platforms.length) }, worker));
    if (fatal) throw fatal;
    console.log(`[userSource] ${dateStart}~${dateEnd} 各平台耗時：${timing.join('、')}`);
    return finish(platforms, rows, failed);
}

module.exports = { fetchUserStats, isConfigured, keyInfo, SourceNotConfigured, splitLottery };
