const crypto = require('crypto');

const ALLOWED_ORIGIN = 'https://rtp-wffq.vercel.app';

function makeToken(user, pass) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    return crypto.createHmac('sha256', secret).update(`${user}:${pass}`).digest('hex');
}

module.exports = async function handler(req, res) {
    const origin = req.headers['origin'] || '';
    if (origin && origin !== ALLOWED_ORIGIN) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (!body || typeof body !== 'object') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const { username, password } = body;
        const validUser = process.env.LOGIN_USER;
        const validPass = process.env.LOGIN_PASS;

        if (!username || !password || username !== validUser || password !== validPass) {
            // 固定延遲防暴力破解
            await new Promise(r => setTimeout(r, 1000));
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }

        const token = makeToken(validUser, validPass);
        res.status(200).json({ token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
