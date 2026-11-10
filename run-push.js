// Railway Cron 呼叫此腳本
// 執行推播邏輯後自動退出
const { runPush } = require('./lib/push');
const pool = require('./lib/db');

runPush()
    .then(result => {
        console.log(JSON.stringify(result));
        process.exit(0);
    })
    .catch(err => {
        console.error('Push failed:', err.message);
        process.exit(1);
    })
    .finally(() => pool.end().catch(() => {}));
