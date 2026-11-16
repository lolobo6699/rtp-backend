// 發送 TG 訊息到預設群組（錯誤訊息會遮掉 Token）
const { describeError } = require('./errors');

const TG_MAX_LEN = 4000;

function hideToken(s) {
    const t = process.env.TG_TOKEN;
    return t ? String(s).split(t).join('***') : String(s);
}

async function sendOne(text) {
    const base = process.env.TG_API_URL || 'https://api.telegram.org';
    let res, body;
    try {
        res = await fetch(`${base}/bot${process.env.TG_TOKEN}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text }),
            signal:  AbortSignal.timeout(20000),
        });
        body = await res.text();
    } catch (err) {
        throw new Error(`TG 連線失敗：${hideToken(describeError(err))}`);
    }
    let data;
    try {
        data = JSON.parse(body);
    } catch (_) {
        throw new Error(`TG 回傳非 JSON（HTTP ${res.status}）：${hideToken(body.slice(0, 200))}`);
    }
    if (!data.ok) throw new Error(`TG 推播失敗：${data.description || '未知原因'}`);
}

// blocks：每個區塊是一段完整文字，會盡量合併成一則，超過長度才分則
async function sendBlocks(blocks) {
    const messages = [];
    let cur = '';
    for (const b of blocks) {
        if (cur && cur.length + 2 + b.length > TG_MAX_LEN) {
            messages.push(cur);
            cur = '';
        }
        cur = cur ? `${cur}\n\n${b}` : b;
    }
    if (cur) messages.push(cur);
    for (const m of messages) await sendOne(m);
    return messages.length;
}

module.exports = { sendBlocks };
