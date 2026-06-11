
function safeFilename(name) {
    let safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
    while (safe.includes('..')) safe = safe.replace('..', '_');
    safe = safe.replace(/^\.+/, '');
    return safe || 'unknown';
}

// 测试用例
const cases = [
    // [输入, 不允许包含, 不允许以...开头]
    ["normal.mp4", "..", "."],
    ["../escape.mp4", "..", "."],
    ["..hidden", "..", "."],
    [".hidden", "..", "."],
    ["path/../etc/passwd", "..", "."],
    [".../.../...", "..", "."],
    ["", "..", "."],
    ["../../../etc/passwd", "..", "."],
    ["a/../../b/c", "..", "."],
];

let failed = 0;
for (const [input] of cases) {
    const result = safeFilename(input);
    if (result.includes('..')) { console.log(`FAIL: '${input}' -> '${result}' (contains ..)`); failed++; }
    if (result.startsWith('.')) { console.log(`FAIL: '${input}' -> '${result}' (starts with .)`); failed++; }
}
console.log(`${failed > 0 ? 'FAILED ' + failed : 'All passed'}`);
process.exit(failed > 0 ? 1 : 0);
        