const ALLOWED_ORIGIN = 'https://lolobo6699.github.io';

// 簡易 Rate Limiter：每個 IP 每分鐘最多 5 次
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

module.exports = async function handler(req, res) {
    const origin = req.headers['origin'] || '';

    // CORS 白名單：只允許 GitHub Pages
    if (origin && origin !== ALLOWED_ORIGIN) {
        return res.status(403).json({ error: 'Forbidden: origin not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Rate limit 檢查
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
