module.exports = function handler(req, res) {
    res.status(200).json({ version: 'v5', ts: Date.now() });
};
