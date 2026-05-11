const { ProxyAgent, fetch: proxyFetch } = require('undici');

const STATS_API = 'https://stats-crawler.up.railway.app';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        if (!body || typeof body !== 'object') body = {};

        const apiKey   = process.env.STATS_API_KEY;
        const proxyUrl = process.env.PROXY_URL;

        const requestBody = JSON.stringify(body);

        const fetchOptions = {
            method: 'POST',
            headers: {
                'X-Api-Key': apiKey,
                'Content-Type': 'application/json',
            },
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
                sentBody: requestBody,
                proxyUsed: !!proxyUrl,
            });
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({
            error: err.message,
            stack: err.stack ? err.stack.slice(0, 300) : null,
        });
    }
};
