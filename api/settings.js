const pool = require('../lib/db');
const crypto = require('crypto');

function verifyToken(token) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    const expected = crypto.createHmac('sha256', secret)
        .update(`${process.env.LOGIN_USER}:${process.env.LOGIN_PASS}`)
        .digest('hex');
    return token === expected;
}

module.exports = async function handler(req, res) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!verifyToken(token)) {
        return res.status(401).json({ error: '未授權，請重新登入' });
    }

    try {
        if (req.method === 'GET') {
            const result = await pool.query("SELECT value FROM settings WHERE key = 'threshold'");
            return res.json({ threshold: parseFloat(result.rows[0]?.value ?? '0.012') });
        }

        if (req.method === 'POST') {
            const v = parseFloat((req.body || {}).threshold);
            if (isNaN(v) || v <= 0 || v >= 1) return res.status(400).json({ error: '門檻需介於 0~1' });
            await pool.query(
                "INSERT INTO settings (key, value) VALUES ('threshold', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                [String(v)]
            );
            return res.json({ ok: true, threshold: v });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[settings]', err.message);
        res.status(500).json({ error: err.message });
    }
};
