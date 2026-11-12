const pool = require('./lib/db');

const MERCHANTS = [
    { name:'XO',  maxBonus:0.988 },
    { name:'XH',  maxBonus:0.989 },
    { name:'LS',  maxBonus:0.991 },
    { name:'OL',  maxBonus:0.990 },
    { name:'XY',  maxBonus:0.994 },
    { name:'FB',  maxBonus:0.988 },
    { name:'MT',  maxBonus:0.992 },
    { name:'JD',  maxBonus:0.990 },
    { name:'ND',  maxBonus:0.999 },
    { name:'YD',  maxBonus:0.998 },
    { name:'SH',  maxBonus:0.988 },
    { name:'YS',  maxBonus:0.989 },
    { name:'JY',  maxBonus:0.994 },
    { name:'HS',  maxBonus:0.999 },
    { name:'RF',  maxBonus:0.999 },
    { name:'TD',  maxBonus:0.998 },
    { name:'DS',  maxBonus:0.999 },
];

async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS merchants (
            name       TEXT PRIMARY KEY,
            max_bonus  NUMERIC(6,4) NOT NULL,
            active     BOOLEAN NOT NULL DEFAULT true
        )
    `);
    for (const m of MERCHANTS) {
        await pool.query(
            'INSERT INTO merchants (name, max_bonus, active) VALUES ($1, $2, true) ON CONFLICT (name) DO NOTHING',
            [m.name, m.maxBonus]
        );
    }
    console.log('Migration 完成，共插入', MERCHANTS.length, '筆商戶');
    await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
