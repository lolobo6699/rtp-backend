process.on('uncaughtException', err => {
    console.error('UncaughtException:', err.message);
    process.exitCode = 1;
});
process.on('unhandledRejection', reason => {
    console.error('UnhandledRejection:', reason);
    process.exitCode = 1;
});

const { runPush } = require('./lib/push');
const pool = require('./lib/db');

runPush()
    .then(result => {
        console.log(JSON.stringify(result));
    })
    .catch(err => {
        console.error('Push failed:', err.message, err.stack);
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
