
function safeFilename(name) {
    let safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
    while (safe.includes('..')) safe = safe.replace('..', '_');
    safe = safe.replace(/^\.+/, '');
    return safe || 'unknown';
}
const cases = [
    {in: "", out: "unknown"},
    {in: null, out: "unknown"},
    {in: undefined, out: "unknown"},
    {in: 123, out: "123"},
    {in: "\x00\\x00", out: "_x00__x00"},
    {in: "✅🎉中文", out: "✅🎉中文"},
    {in: "....", out: ""},
    {in: "   space   ", out: "space"},
];
let ok = true;
for (const c of cases) {
    const r = safeFilename(c.in);
    if (c.out === "" && r === "") continue;
    if (r === c.out) continue;
    console.log(`MISMATCH: input='${c.in}' expected='${c.out}' got='${r}'`);
    ok = false;
}
if (ok) console.log("All edge cases passed");
else process.exit(1);
    