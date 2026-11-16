// 把錯誤一路往 cause 挖到底，每一層都寫出來（fetch 的真正原因常包在第 2、3 層）
function describeError(err) {
    const parts = [];
    const seen = new Set();

    function visit(e, depth) {
        if (!e || depth > 8 || seen.has(e)) return;
        seen.add(e);
        if (typeof e !== 'object') {
            parts.push(String(e));
            return;
        }
        const name = e.name && !['Error', 'TypeError'].includes(e.name) ? e.name : '';
        const code = typeof e.code === 'string' ? e.code : '';
        const status = e.statusCode || e.status || '';
        const text = [name, code, status, e.message].filter(Boolean).join(' ');
        if (text && !parts.includes(text)) parts.push(text);
        if (Array.isArray(e.errors)) e.errors.forEach(sub => visit(sub, depth + 1));
        visit(e.cause, depth + 1);
    }

    visit(err, 0);
    return parts.join(' ← ') || '未知錯誤';
}

module.exports = { describeError };
