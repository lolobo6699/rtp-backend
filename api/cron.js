const { runPush } = require('../lib/push');

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
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
