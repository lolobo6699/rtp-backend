module.exports = async function handler(req, res) {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!cronSecret || auth !== cronSecret) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const statsApi = process.env.STATS_API_URL;
    const apiKey   = process.env.STATS_API_KEY;

    const start = Date.now();
    try {
        const r = await fetch(`${statsApi}/api/v1/lottery-stats`, {
            method:  'POST',
            headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                platforms:   ['XO'],
                lotteryType: '奇趣腾讯分分彩',
                dateStart:   '2026-07-01',
                dateEnd:     '2026-07-21',
            }),
            signal: AbortSignal.timeout(30000),
        });
        const ms = Date.now() - start;
        const data = await r.json();
        return res.json({ ok: true, ms, status: r.status, rows: (data.rows || []).length });
    } catch (err) {
        const ms = Date.now() - start;
        return res.json({ ok: false, ms, error: err.message });
    }
};
