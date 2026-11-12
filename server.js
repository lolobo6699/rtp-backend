const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login',      require('./api/login'));
app.post('/api/stats',      require('./api/stats'));
app.post('/api/notify',     require('./api/notify'));
app.all('/api/cron',        require('./api/cron'));
app.all('/api/test-stats',  require('./api/test-stats'));
app.get('/api/ping',        require('./api/ping'));
app.all('/api/merchants',   require('./api/merchants'));
app.all('/api/merchants/:name', require('./api/merchants'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RTP server running on port ${PORT}`));
