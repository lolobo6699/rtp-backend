const { ProxyAgent, fetch: proxyFetch } = require('undici');
const crypto = require('crypto');

function verifyToken(token) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    const expected = crypto.createHmac('sha256', secret)
        .update(`${process.env.LOGIN_USER}:${process.env.LOGIN_PASS}`)
        .digest('hex');
    return token === expected;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!verifyToken(token)) {
        return res.status(401).json({ error: '未授權，請重新登入' });
    }

    try {
        const body     = req.body || {};
        const apiKey   = process.env.STATS_API_KEY;
        const proxyUrl = process.env.PROXY_URL;
        const statsApi = process.env.STATS_API_URL;

        const fetchOptions = {
            method:  'POST',
            headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(50000),
        };

        let response;
        if (proxyUrl) {
            const dispatcher = new ProxyAgent(proxyUrl);
            response = await proxyFetch(`${statsApi}/api/v1/lottery-stats`, { ...fetchOptions, dispatcher });
        } else {
            response = await fetch(`${statsApi}/api/v1/lottery-stats`, fetchOptions);
        }

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(500).json({ error: 'API 回傳非 JSON', httpStatus: response.status, rawBody: text.slice(0, 500) });
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
