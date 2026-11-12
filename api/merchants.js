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
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!verifyToken(token)) {
        return res.status(401).json({ error: '未授權，請重新登入' });
    }

    if (req.method === 'GET') {
        const result = await pool.query(
            'SELECT name, max_bonus FROM merchants WHERE active = true ORDER BY name'
        );
        return res.json({ merchants: result.rows });
    }

    if (req.method === 'POST') {
        const { name, maxBonus } = req.body || {};
        if (!name || !maxBonus) return res.status(400).json({ error: '缺少 name 或 maxBonus' });
        const n = String(name).toUpperCase().trim();
        const b = parseFloat(maxBonus);
        if (isNaN(b) || b <= 0 || b > 1) return res.status(400).json({ error: 'maxBonus 需介於 0~1' });
        await pool.query(
            'INSERT INTO merchants (name, max_bonus, active) VALUES ($1, $2, true) ON CONFLICT (name) DO UPDATE SET max_bonus = $2, active = true',
            [n, b]
        );
        return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
        const name = req.params?.name || (req.url.split('/').pop());
        if (!name) return res.status(400).json({ error: '缺少 name' });
        await pool.query('UPDATE merchants SET active = false WHERE name = $1', [name.toUpperCase()]);
        return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
