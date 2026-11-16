// Railway Cron 呼叫此腳本：只負責通知 rtp-backend 推播，抓資料與推 TG 都由 rtp-backend 執行
const { describeError } = require('./lib/errors');
const BACKEND_URL = process.env.BACKEND_URL || 'http://rtp-backend.railway.internal:8080';

function finish(code) {
    // 留時間讓 log 寫出去再結束
    setTimeout(() => process.exit(code), 500);
}

// 保險：超過 290 秒強制結束，避免卡住擋到下一次排程（間隔 5 分鐘）
// rtp-backend 平台推播內部重試最長約 150 秒；個人推播逐平台查詢，平台慢時可能 2～4 分鐘
setTimeout(() => { console.error('Timeout: 執行超過 290 秒'); finish(1); }, 290000).unref();

async function main() {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret) throw new Error('缺少 CRON_SECRET 環境變數');

    let res;
    try {
        res = await fetch(`${BACKEND_URL}/api/cron`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${secret}` },
            signal:  AbortSignal.timeout(280000),
        });
    } catch (err) {
        throw new Error(`連不到 rtp-backend：${describeError(err)}`);
    }

    let text;
    try {
        text = await res.text();
    } catch (err) {
        throw new Error(`讀取 rtp-backend 回應失敗：${describeError(err)}`);
    }
    if (!res.ok) throw new Error(`rtp-backend 回傳 HTTP ${res.status}：${text.slice(0, 300)}`);
    console.log(text);
}

main()
    .then(() => finish(0))
    .catch(err => { console.error('Push failed:', describeError(err)); finish(1); });
