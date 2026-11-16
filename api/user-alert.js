// 後台：個人異常推播的設定、預覽、測試推播
const crypto = require('crypto');
const { describeError } = require('../lib/errors');
const ua = require('../lib/user-alert');

function verifyToken(token) {
    const secret = process.env.STATS_API_KEY || 'fallback';
    const expected = crypto.createHmac('sha256', secret)
        .update(`${process.env.LOGIN_USER}:${process.env.LOGIN_PASS}`)
        .digest('hex');
    return token === expected;
}

// 預覽／測試推播用：門檻必填，不要求啟用
function checkForRun(body) {
    const { config, error } = ua.validateConfig({ ...body, enabled: false });
    if (error) return { error };
    if (config.lotteries.length === 0) return { error: '請至少選一個彩種' };
    if (config.rtpMin === null || config.profitMin === null) return { error: '請先填寫 RTP 門檻與盈虧門檻' };
    return { config };
}

module.exports = async function handler(req, res) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!verifyToken(token)) return res.status(401).json({ error: '未授權，請重新登入' });

    const action = req.params.action || '';
    try {
        if (req.method === 'GET' && !action) {
            return res.json({
                config:      await ua.getConfig(),
                options:     ua.LOTTERY_OPTIONS,
                dateModes:   ua.DATE_MODES,
                sourceReady: ua.isConfigured(),
            });
        }

        if (req.method === 'POST' && !action) {
            const { config, error } = ua.validateConfig(req.body);
            if (error) return res.status(400).json({ error });
            await ua.saveConfig(config);
            return res.json({ ok: true, config });
        }

        if (req.method === 'POST' && (action === 'preview' || action === 'test')) {
            const { config, error } = checkForRun(req.body);
            if (error) return res.status(400).json({ error });
            if (!ua.isConfigured()) return res.status(400).json({ error: '個人統計資料來源尚未設定，API 接上後才能使用' });
            const result = await ua.findAlerts(config);
            if (action === 'test') {
                if (result.alerts.length === 0) return res.json({ ...result, sent: 0 });
                const sent = await ua.sendBlocks(result.alerts.map(r => ua.formatBlock(r, result.dateStart, result.dateEnd)));
                return res.json({ ...result, sent });
            }
            return res.json(result);
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        const reason = describeError(err);
        console.error('[user-alert]', reason);
        res.status(500).json({ error: reason });
    }
};
