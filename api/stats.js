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

        const apiUrl = process.env.STATS_API_URL;
        const response = await fetch(`${apiUrl}/api/v1/lottery-stats`, {
            method: 'POST',
            headers: {
                'X-Api-Key': process.env.STATS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(500).json({
                error: 'API 回傳非 JSON',
                status: response.status,
                body: text.slice(0, 300),
            });
        }
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
