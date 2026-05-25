module.exports = function handler(req, res) {
    res.status(200).json({ version: 'v7', ts: Date.now() });
};
