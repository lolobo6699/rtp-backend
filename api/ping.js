module.exports = function handler(req, res) {
    res.status(200).json({ version: 'v6', ts: Date.now() });
};
