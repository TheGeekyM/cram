const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const auth = require('./auth');
const cli = require('./cli');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// ponytail: CRAM_DATA set by main.js to Electron userData; web mode keeps data next to the code
const DATA = process.env.CRAM_DATA || path.join(__dirname, 'data');
const STUDIES = path.join(DATA, 'studies');
fs.mkdirSync(STUDIES, { recursive: true });
auth.init(DATA, null); // main.js re-inits with safeStorage
const SETTINGS = path.join(DATA, 'settings.json');
const settings = () => fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS)) : { model: 'claude-opus-5' };
const study = id => JSON.parse(fs.readFileSync(path.join(STUDIES, id, 'study.json')));
const save = s => fs.writeFileSync(path.join(STUDIES, s.id, 'study.json'), JSON.stringify(s));
const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5'];

// ---------- settings ----------
app.get('/api/settings', (req, res) => {
  const s = settings();
  const source = useCli() ? 'cli' : auth.signedIn() ? 'claude' : (s.apiKey || process.env.ANTHROPIC_API_KEY) ? 'key' : null;
  res.json({ ...s, provider: s.provider || 'auto', cli: cli.available(), apiKey: s.apiKey ? `${s.apiKey.slice(0, 10)}…${s.apiKey.slice(-4)}` : '', hasKey: !!source, source, models: MODELS });
});
app.post('/api/settings', (req, res) => {
  const s = settings();
  if (req.body.apiKey && !req.body.apiKey.includes('…')) s.apiKey = req.body.apiKey.trim();
  if (MODELS.includes(req.body.model)) s.model = req.body.model;
  if (['auto', 'api'].includes(req.body.provider)) s.provider = req.body.provider;
  fs.writeFileSync(SETTINGS, JSON.stringify(s)); res.json({ ok: true });
});

// ---------- sign in with Claude ----------
app.post('/api/auth/start', (req, res) => { const url = auth.start(); app.openExternal?.(url); res.json({ url }); });
app.post('/api/auth/code', async (req, res) => { try { await auth.exchange(req.body.code || ''); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/auth/logout', (req, res) => { auth.logout(); res.json({ ok: true }); });

// ---------- claude ----------
// Provider order: Claude Code CLI (subscription, no API throttling) → OAuth token → API key.
const useCli = () => (settings().provider || 'auto') !== 'api' && cli.available();
// OAuth (subscription) first, API key as fallback. OAuth needs its beta flag on every request.
async function client() {
  const tok = await auth.token();
  if (tok) return { c: new Anthropic({ authToken: tok }), betas: ['server-side-fallback-2026-07-01', auth.OAUTH_BETA] };
  return { c: new Anthropic({ apiKey: settings().apiKey || process.env.ANTHROPIC_API_KEY }), betas: ['server-side-fallback-2026-07-01'] };
}
const SYSTEM = `You are Cram, a sharp, friendly study tutor. Teach from the provided material; where it is silent, use solid general knowledge and say so. Be concrete, use examples, keep answers tight. Use Markdown.`;
// Stable prefix for prompt caching: PDF (if any) goes in the first user turn with cache_control
function context(s) {
  const pdf = path.join(STUDIES, s.id, 'source.pdf');
  const intro = `Study: "${s.title}". Subject: ${s.subject || s.title}.`;
  if (!fs.existsSync(pdf)) return { system: `${SYSTEM}\n${intro}`, prefix: [], pdf: null };
  return { system: `${SYSTEM}\n${intro} The study material is the attached PDF.`, pdf, prefix: [
    { role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(pdf).toString('base64') }, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'This is the study material.' }] },
    { role: 'assistant', content: 'Got it. I have read the material and am ready.' }] };
}
const req = (s, messages, extra = {}) => {
  const { system, prefix } = context(s);
  return { model: settings().model || 'claude-opus-5', max_tokens: 16000, fallbacks: 'default', system, ...extra, messages: [...prefix, ...messages] };
};
// stream text deltas straight to the HTTP response; returns full text
async function streamText(res, s, messages, extra) {
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  let text = '';
  if (useCli()) {
    const { system, pdf } = context(s);
    const r = await cli.stream({ system: extra?.system || system, messages, model: settings().model || 'claude-opus-5', pdf, onDelta: d => { text += d; res.write(d); } });
    if (!r.ok) res.write(`\n\n**Error:** ${r.message}`);
    res.end(); return text;
  }
  try {
    const { c, betas } = await client();
    const stream = c.beta.messages.stream({ ...req(s, messages, extra), betas });
    for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { text += ev.delta.text; res.write(ev.delta.text); }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') res.write('\n\n*(Claude declined this request.)*');
  } catch (e) { res.write(`\n\n**Error:** ${e.message}`); }
  res.end(); return text;
}
async function json(s, prompt, extra) {
  let text;
  if (useCli()) {
    const { system, pdf } = context(s);
    const r = await cli.stream({ system, messages: [{ role: 'user', content: prompt }], model: settings().model || 'claude-opus-5', pdf });
    if (!r.ok) throw new Error(r.message); text = r.text;
  } else {
    const { c, betas } = await client();
    const r = await c.beta.messages.create({ ...req(s, [{ role: 'user', content: prompt }], extra), betas });
    text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); // ponytail: JSON-in-prompt + regex extract, swap for output_config.format if it ever misparses
  return JSON.parse(m ? m[0] : text);
}

// ---------- studies ----------
app.get('/api/studies', (req, res) => res.json(fs.readdirSync(STUDIES).map(study).sort((a, b) => b.updatedAt - a.updatedAt)
  .map(({ id, title, subject, hasPdf, updatedAt, quizzes }) => ({ id, title, subject, hasPdf, updatedAt, quizzes: quizzes.length }))));
app.get('/api/pick-pdf', async (req, res) => res.json({ file: await app.pickPdf?.() || null }));
app.post('/api/studies', (req, res) => {
  const { title, subject, pdfPath } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (pdfPath && fs.statSync(pdfPath).size > 30e6) return res.status(400).json({ error: 'PDF over 30 MB' });
  const s = { id: Date.now().toString(36), title: title.trim(), subject: (subject || '').trim(), hasPdf: !!pdfPath, createdAt: Date.now(), updatedAt: Date.now(), chat: [], interview: [], quizzes: [], challenges: [] };
  fs.mkdirSync(path.join(STUDIES, s.id));
  if (pdfPath) fs.copyFileSync(pdfPath, path.join(STUDIES, s.id, 'source.pdf'));
  save(s); res.json(s);
});
app.get('/api/studies/:id', (req, res) => res.json(study(req.params.id)));
app.delete('/api/studies/:id', (req, res) => { fs.rmSync(path.join(STUDIES, req.params.id), { recursive: true }); res.json({ ok: true }); });
const touch = s => { s.updatedAt = Date.now(); save(s); };

// ---------- notes (same semantics as aidle's notes:* IPC handlers) ----------
const tree = import('./src/core/notesTree.mjs'); // ESM shared with the renderer; ponytail: one dynamic import, awaited per call
const notesFile = id => path.join(STUDIES, id, 'notes.json');
const loadNotes = id => { try { return JSON.parse(fs.readFileSync(notesFile(id), 'utf8')); } catch { return []; } };
const saveNotes = (id, notes) => fs.writeFileSync(notesFile(id), JSON.stringify(notes));
app.post('/api/studies/:id/notes/list', async (req, res) => {
  try { const { migrateGroups } = await tree; const { notes, changed } = migrateGroups(loadNotes(req.params.id), req.body.extraFolders || []); if (changed) saveNotes(req.params.id, notes); res.json({ ok: true, notes }); }
  catch (e) { res.json({ ok: false, message: e.message, notes: [] }); }
});
app.post('/api/studies/:id/notes/save', (req, res) => {
  try {
    const notes = loadNotes(req.params.id), note = req.body.note, now = Date.now();
    const i = notes.findIndex(n => n.id === note.id), merged = { ...note, updatedAt: now, createdAt: note.createdAt || now };
    if (i >= 0) notes[i] = merged; else notes.unshift(merged);
    saveNotes(req.params.id, notes); res.json({ ok: true, note: merged });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/studies/:id/notes/reorder', (req, res) => {
  try {
    const notes = loadNotes(req.params.id), byId = new Map(notes.map(n => [n.id, n]));
    const ordered = (req.body.ids || []).map(id => byId.get(id)).filter(Boolean), seen = new Set(ordered.map(n => n.id));
    saveNotes(req.params.id, [...ordered, ...notes.filter(n => !seen.has(n.id))]); res.json({ ok: true });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/studies/:id/notes/delete', async (req, res) => {
  try { const { removeNote } = await tree; const notes = removeNote(loadNotes(req.params.id), req.body.id); saveNotes(req.params.id, notes); res.json({ ok: true, notes }); }
  catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/notes/export', async (req, res) => res.json(app.exportNote ? await app.exportNote(req.body) : { ok: false, message: 'Export needs the desktop app.' }));
app.post('/api/show-in-folder', (req, res) => { app.showInFolder?.(req.body.path); res.json({ ok: true }); });

// ---------- ask ----------
app.post('/api/studies/:id/chat', async (req, res) => {
  const s = study(req.params.id);
  s.chat.push({ role: 'user', content: req.body.message });
  const text = await streamText(res, s, s.chat);
  s.chat.push({ role: 'assistant', content: text }); touch(s);
});
app.delete('/api/studies/:id/chat', (req, res) => { const s = study(req.params.id); s.chat = []; touch(s); res.json({ ok: true }); });

// ---------- quiz ----------
app.post('/api/studies/:id/quiz', async (req, res) => {
  const s = study(req.params.id); const { n = 8, difficulty = 'mixed', topic = '' } = req.body;
  try {
    const q = await json(s, `Write a ${n}-question multiple-choice quiz on the study material${topic ? ` focused on: ${topic}` : ''}. Difficulty: ${difficulty}. Cover different parts of the material, avoid trivia. Respond with ONLY JSON: {"title": string, "questions": [{"q": string, "choices": [4 strings], "answer": index 0-3, "explanation": string}]}`);
    q.id = Date.now().toString(36); q.at = Date.now(); q.difficulty = difficulty; res.json(q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/studies/:id/quiz/result', (req, res) => { const s = study(req.params.id); s.quizzes.push(req.body); touch(s); res.json({ ok: true }); });

// ---------- interview ----------
const INTERVIEW = `You are now running a spoken-style oral exam / job interview on the study material. Ask ONE question at a time. After each answer: give brief honest feedback (what was right, what was missing, the ideal answer in 2-4 lines), then ask the next question, going deeper or sideways based on the answer. Mix conceptual, applied and "explain it to me" questions. After 8 questions, stop and give a final report: score /10, strengths, gaps, what to revise. Start now with a one-line welcome and the first question.`;
app.post('/api/studies/:id/interview', async (req, res) => {
  const s = study(req.params.id);
  if (req.body.reset) s.interview = [];
  if (req.body.message) s.interview.push({ role: 'user', content: req.body.message });
  const msgs = s.interview.length ? s.interview : [{ role: 'user', content: 'Begin the interview.' }];
  const text = await streamText(res, s, msgs, { system: `${context(s).system}\n\n${INTERVIEW}` });
  if (!s.interview.length) s.interview.push(msgs[0]);
  s.interview.push({ role: 'assistant', content: text }); touch(s);
});

// ---------- code challenges ----------
const RUNNERS = { javascript: ['node', '-e'], python: ['python3', '-c'] };
app.post('/api/studies/:id/challenge', async (req, res) => {
  const s = study(req.params.id); const { language = 'javascript', difficulty = 'medium', topic = '' } = req.body;
  try {
    const c = await json(s, `Create one HackerRank-style coding challenge that exercises the study material${topic ? ` (topic: ${topic})` : ''}. Difficulty: ${difficulty}. Language: ${language}. The program reads ALL input from stdin and prints the answer to stdout. Give 5 tests with exact stdin and exact expected stdout (trailing newline optional). Starter code must read stdin and contain a TODO. Respond with ONLY JSON: {"title": string, "statement": markdown string with problem, input format, output format, constraints, "examples": [{"input": string, "output": string, "explanation": string}], "starter": string, "tests": [{"input": string, "output": string}]}`);
    c.id = Date.now().toString(36); c.at = Date.now(); c.language = language; c.difficulty = difficulty; res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const run = (language, code, input) => new Promise(r => {
  const [bin, flag] = RUNNERS[language]; let out = '', err = '';
  const p = spawn(bin, [flag, code], { timeout: 5000 });
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', code => r({ out: out.trim(), err: err.trim().slice(-800), code }));
  p.on('error', e => r({ out: '', err: e.message, code: -1 }));
  p.stdin.end(input);
});
app.post('/api/run', async (req, res) => {
  const { language, code, tests = [] } = req.body;
  if (!RUNNERS[language]) return res.status(400).json({ error: 'unsupported language' });
  const results = [];
  for (const t of tests) { const r = await run(language, code, t.input); results.push({ ...t, ...r, pass: r.out === t.output.trim() }); }
  res.json({ results, passed: results.filter(r => r.pass).length });
});
app.post('/api/studies/:id/challenge/review', async (req, res) => {
  const s = study(req.params.id); const { challenge, code, results } = req.body;
  const summary = results ? `Test results: ${results.passed}/${results.results.length} passed.\n${results.results.map((r, i) => `Test ${i + 1}: ${r.pass ? 'PASS' : `FAIL (expected ${JSON.stringify(r.output)}, got ${JSON.stringify(r.out)}${r.err ? `, stderr: ${r.err}` : ''})`}`).join('\n')}` : 'Tests not run.';
  const text = await streamText(res, s, [{ role: 'user', content: `Review my ${challenge.language} solution to this challenge.\n\n## Challenge\n${challenge.title}\n${challenge.statement}\n\n## My code\n\`\`\`${challenge.language}\n${code}\n\`\`\`\n\n## ${summary}\n\nGive: correctness verdict, bugs or edge cases missed, complexity, how it relates to the study material, and a cleaner reference solution. Be direct.` }]);
  s.challenges.push({ id: challenge.id, title: challenge.title, language: challenge.language, at: Date.now(), passed: results?.passed ?? null, total: results?.results?.length ?? challenge.tests.length }); touch(s);
});

module.exports = app;
if (require.main === module) app.listen(3000, '127.0.0.1', () => console.log('http://localhost:3000'));
