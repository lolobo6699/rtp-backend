module.exports = function handler(req, res) {
    res.status(200).json({ version: 'v4', ts: Date.now() });
};
