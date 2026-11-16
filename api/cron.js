const { runPush } = require('../lib/push');
const { describeError } = require('../lib/errors');

module.exports = async function handler(req, res) {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

    if (!cronSecret) return res.status(401).json({ error: 'env_not_set' });
    if (auth !== cronSecret) return res.status(401).json({ error: 'token_mismatch' });

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const result = await runPush();
        console.log('[cron] 推播結果:', JSON.stringify(result));
        res.status(200).json(result);
    } catch (err) {
        const reason = describeError(err);
        console.error('[cron] 推播失敗:', reason);
        res.status(500).json({ error: reason });
    }
};
