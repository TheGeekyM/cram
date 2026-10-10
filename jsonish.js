// Parse the JSON a model wrote. Models sometimes wrap it in prose or put raw double quotes inside a string
// ("you answered "only the PC""), which JSON.parse rejects. Strategy: take the first balanced {...} or [...]
// (string-aware), try JSON.parse, and if that fails escape every quote that cannot be the end of a string.
// ponytail: heuristic repair; the caller retries the model once if this still throws.
function slice(text) {
  const start = text.search(/[\[{]/); if (start < 0) throw new Error('No JSON in the model reply.');
  const open = []; let inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') { open.pop(); if (!open.length) return text.slice(start, i + 1); }
  }
  // unbalanced: models sometimes drop the last closer(s) — close what is still open, JSON.parse judges the rest
  return text.slice(start).trimEnd() + open.reverse().join('');
}
// a quote closes a string only if the next non-space char is , : } ] or the end
function repairQuotes(s) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (esc) { esc = false; out += c; continue; }
    if (c === '\\') { esc = true; out += c; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '"') { const next = s.slice(i + 1).match(/^\s*(.)/)?.[1]; if (next === undefined || ',:}]'.includes(next)) { inStr = false; out += c; } else out += '\\"'; continue; }
    out += c;
  }
  return out;
}
function parse(text) {
  const t = String(text || '');
  try { return JSON.parse(t); } catch {}
  const cut = t.includes('{') || t.includes('[') ? (() => { try { return slice(t); } catch { return t; } })() : t;
  try { return JSON.parse(cut); } catch (e1) {
    try { return JSON.parse(repairQuotes(cut)); } catch { throw e1; }
  }
}
module.exports = { parse };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(parse('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(parse('Here you go:\n```json\n{"a":[1,2],"b":"x}"}\n```\nHope it helps {not json}'), { a: [1, 2], b: 'x}' }, 'prose around, brace inside a string');
  assert.deepStrictEqual(parse('{"w":["You answered "only the program counter" and missed the rest","ok"]}'), { w: ['You answered "only the program counter" and missed the rest', 'ok'] }, 'raw quotes inside an array string');
  assert.throws(() => parse('{"s":"He said "hi": then left","n":2}'), 'known limit: a raw quote followed by a colon looks like a key; the caller retries the model');
  assert.deepStrictEqual(parse('{"s":"line one\nline two"}'), { s: 'line one\nline two' }, 'raw newline in string');
  assert.deepStrictEqual(parse('{"url":"https://x.y/a?b=\\"c\\""}'), { url: 'https://x.y/a?b="c"' }, 'already escaped quotes untouched');
  assert.throws(() => parse('no json here'), 'no JSON throws');
  assert.deepStrictEqual(parse('Plan first.{"items":[{"t":"a","d":0},{"t":"b","d":1}]'), { items: [{ t: 'a', d: 0 }, { t: 'b', d: 1 }] }, 'missing final closer');
  console.log('jsonish ok');
}
