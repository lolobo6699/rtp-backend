const crypto = require('crypto');

function makeToken(user, pass) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    return crypto.createHmac('sha256', secret).update(`${user}:${pass}`).digest('hex');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { username, password } = req.body || {};
        const validUser = process.env.LOGIN_USER;
        const validPass = process.env.LOGIN_PASS;

        if (!username || !password || username !== validUser || password !== validPass) {
            await new Promise(r => setTimeout(r, 1000));
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }

        const token = makeToken(validUser, validPass);
        res.status(200).json({ token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
