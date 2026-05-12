const { ProxyAgent, fetch: proxyFetch } = require('undici');

const STATS_API      = process.env.STATS_API_URL;
const ALLOWED_ORIGIN = 'https://rtp-wffq.vercel.app';

// 從 request stream 手動讀取原始 body
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    const origin = req.headers['origin'] || '';

    // CORS 白名單：只允許 Vercel 前端（同源請求無 origin header 也放行）
    if (origin && origin !== ALLOWED_ORIGIN) {
        return res.status(403).json({ error: 'Forbidden: origin not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body;
        try { body = req.body; } catch (e) { body = null; }

        if (!body || typeof body !== 'object') {
            try {
                const raw = typeof body === 'string' ? body : await readRawBody(req);
                body = JSON.parse(raw);
            } catch (e) { body = {}; }
        }

        const apiKey   = process.env.STATS_API_KEY;
        const proxyUrl = process.env.PROXY_URL;
        const requestBody = JSON.stringify(body);

        const fetchOptions = {
            method: 'POST',
            headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
            body: requestBody,
        };

        let response;
        if (proxyUrl) {
            const dispatcher = new ProxyAgent(proxyUrl);
            response = await proxyFetch(`${STATS_API}/api/v1/lottery-stats`, { ...fetchOptions, dispatcher });
        } else {
            response = await fetch(`${STATS_API}/api/v1/lottery-stats`, fetchOptions);
        }

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(500).json({
                error: 'API 回傳非 JSON',
                httpStatus: response.status,
                rawBody: text.slice(0, 500),
            });
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
