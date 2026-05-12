const crypto = require('crypto');

const ALLOWED_ORIGIN = 'https://rtp-wffq.vercel.app';

const rateLimitMap = new Map();
const RATE_LIMIT   = 5;
const WINDOW_MS    = 60 * 1000;

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    if (!record || now - record.windowStart > WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    }
    if (record.count >= RATE_LIMIT) return false;
    record.count++;
    return true;
}

function verifyToken(token) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    const expected = crypto.createHmac('sha256', secret)
        .update(`${process.env.LOGIN_USER}:${process.env.LOGIN_PASS}`)
        .digest('hex');
    return token === expected;
}

module.exports = async function handler(req, res) {
    const origin = req.headers['origin'] || '';
    if (origin && origin !== ALLOWED_ORIGIN) {
        return res.status(403).json({ error: 'Forbidden: origin not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Token 驗證
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!verifyToken(token)) {
        return res.status(401).json({ error: '未授權，請重新登入' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    try {
        let body = req.body;
        if (!body || typeof body !== 'object') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const { text } = body;
        if (!text) return res.status(400).json({ error: 'Missing text field' });

        const response = await fetch(
            `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text }),
            }
        );
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
