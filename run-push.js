const pool = require('./lib/db');

function fail(label, err) {
    console.error(label, err && err.stack ? err.stack : err);
    // 留時間讓 log 寫出去再結束，避免程式卡住擋到下一次排程
    setTimeout(() => process.exit(1), 1000);
}

process.on('uncaughtException', err => fail('UncaughtException:', err));
process.on('unhandledRejection', err => fail('UnhandledRejection:', err));

// 保險：超過 2 分鐘強制結束
setTimeout(() => fail('Timeout:', '執行超過 120 秒'), 120000).unref();

const { runPush } = require('./lib/push');

runPush()
    .then(result => {
        console.log(JSON.stringify(result));
        return pool.end();
    })
    .catch(err => {
        process.exitCode = 1;
        console.error('Push failed:', err.stack || err.message);
        return pool.end().catch(() => {});
    });
