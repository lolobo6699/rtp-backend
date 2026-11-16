const { runPush } = require('../lib/push');
const { runUserAlert } = require('../lib/user-alert');
const { describeError } = require('../lib/errors');

module.exports = async function handler(req, res) {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

    if (!cronSecret) return res.status(401).json({ error: 'env_not_set' });
    if (auth !== cronSecret) return res.status(401).json({ error: 'token_mismatch' });

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 平台 RTP 推播與個人異常推播同時跑，互不影響
    const [platform, user] = await Promise.allSettled([runPush(), runUserAlert()]);
    const result = {};
    let failed = false;

    if (platform.status === 'fulfilled') {
        console.log('[cron] 推播結果:', JSON.stringify(platform.value));
        result.platform = platform.value;
    } else {
        failed = true;
        result.platform = { error: describeError(platform.reason) };
        console.error('[cron] 推播失敗:', result.platform.error);
    }

    if (user.status === 'fulfilled') {
        console.log('[cron] 個人推播結果:', JSON.stringify(user.value));
        result.user = user.value;
    } else {
        failed = true;
        result.user = { error: describeError(user.reason) };
        console.error('[cron] 個人推播失敗:', result.user.error);
    }

    res.status(failed ? 500 : 200).json(result);
};
