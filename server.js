const express = require('express');
const path    = require('path');
const pool    = require('./lib/db');

const INITIAL_MERCHANTS = [
    { name:'XO', maxBonus:0.988 }, { name:'XH', maxBonus:0.989 },
    { name:'LS', maxBonus:0.991 }, { name:'OL', maxBonus:0.990 },
    { name:'XY', maxBonus:0.994 }, { name:'FB', maxBonus:0.988 },
    { name:'MT', maxBonus:0.992 }, { name:'JD', maxBonus:0.990 },
    { name:'ND', maxBonus:0.999 }, { name:'YD', maxBonus:0.998 },
    { name:'SH', maxBonus:0.988 }, { name:'YS', maxBonus:0.989 },
    { name:'JY', maxBonus:0.994 }, { name:'HS', maxBonus:0.999 },
    { name:'RF', maxBonus:0.999 }, { name:'TD', maxBonus:0.998 },
    { name:'DS', maxBonus:0.999 },
];

async function runMigration() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS merchants (
            name       TEXT PRIMARY KEY,
            max_bonus  NUMERIC(6,4) NOT NULL,
            active     BOOLEAN NOT NULL DEFAULT true
        )
    `);
    for (const m of INITIAL_MERCHANTS) {
        await pool.query(
            'INSERT INTO merchants (name, max_bonus, active) VALUES ($1, $2, true) ON CONFLICT (name) DO NOTHING',
            [m.name, m.maxBonus]
        );
    }
    console.log('Migration OK');
}

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
runMigration()
    .then(() => app.listen(PORT, () => console.log(`RTP server running on port ${PORT}`)))
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
