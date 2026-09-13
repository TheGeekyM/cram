const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const auth = require('./auth');
const cli = require('./cli');
const { verify, pruneCache } = require('./linkcheck');

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
// Generic Interview / Code sessions live in a hidden built-in study, so every /api/studies/:id route serves them too.
const GENERAL = '_general';
if (!fs.existsSync(path.join(STUDIES, GENERAL, 'study.json'))) { fs.mkdirSync(path.join(STUDIES, GENERAL), { recursive: true }); save({ id: GENERAL, general: true, title: 'General practice', subject: 'job interview and coding practice', hasPdf: false, createdAt: Date.now(), updatedAt: Date.now(), chat: [], interviews: [], quizzes: [], challenges: [] }); }
const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5'];
// one line per Claude call: what, which provider/model, then how long it took
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[claude]', ...a);
const timed = async (what, s, fn) => { const t = Date.now(); log(`${what} start · ${useCli() ? 'cli' : auth.signedIn() ? 'oauth' : 'api'} · ${settings().model || 'claude-opus-5'} · pdf=${s.hasPdf ? 'yes' : 'no'}`); try { return await fn(); } finally { log(`${what} done in ${((Date.now() - t) / 1000).toFixed(1)}s`); } };

// ---------- settings ----------
app.get('/api/settings', (req, res) => {
  const s = settings();
  const source = useCli() ? 'cli' : auth.signedIn() ? 'claude' : (s.apiKey || process.env.ANTHROPIC_API_KEY) ? 'key' : null;
  res.json({ ...s, provider: s.provider || 'auto', cli: cli.available(), apiKey: s.apiKey ? `${s.apiKey.slice(0, 10)}…${s.apiKey.slice(-4)}` : '', geminiKey: s.geminiKey ? `${s.geminiKey.slice(0, 6)}…${s.geminiKey.slice(-4)}` : '', elevenKey: s.elevenKey ? `${s.elevenKey.slice(0, 6)}…${s.elevenKey.slice(-4)}` : '', elevenKey2: s.elevenKey2 ? `${s.elevenKey2.slice(0, 6)}…${s.elevenKey2.slice(-4)}` : '', hasKey: !!source, source, models: MODELS });
});
app.post('/api/settings', (req, res) => {
  const s = settings();
  if (req.body.apiKey && !req.body.apiKey.includes('…')) s.apiKey = req.body.apiKey.trim();
  for (const k of ['elevenKey', 'elevenKey2']) if (typeof req.body[k] === 'string' && !req.body[k].includes('…')) s[k] = req.body[k].trim();
  if (['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'].includes(req.body.elevenModel)) s.elevenModel = req.body.elevenModel;
  if (typeof req.body.geminiKey === 'string' && !req.body.geminiKey.includes('…')) s.geminiKey = req.body.geminiKey.trim(); // empty clears it
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
const INTERVIEWER = `You are Cram, a seasoned hiring manager and interview coach who has run hundreds of real interviews at strong tech companies. Be realistic, fair and specific. Use Markdown.`;
const SYSTEM = `You are Cram, a sharp, friendly study tutor. Teach from the provided material; where it is silent, use solid general knowledge and say so. Be concrete, use examples, keep answers tight. Use Markdown.`;
// Stable prefix for prompt caching: PDF (if any) goes in the first user turn with cache_control
function context(s) {
  const pdf = path.join(STUDIES, s.id, 'source.pdf');
  if (s.general) return { system: INTERVIEWER, prefix: [], pdf: null };
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
const streamText = (res, s, messages, extra) => timed(`stream ${res.req.path}`, s, () => streamText0(res, s, messages, extra));
async function streamText0(res, s, messages, extra) {
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  let text = '';
  const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); }); // client hit Stop (or left): stop generating
  if (useCli()) {
    const { system, pdf } = context(s);
    const r = await cli.stream({ system: extra?.system || system, messages, model: settings().model || 'claude-opus-5', pdf, signal: ac.signal, onDelta: d => { text += d; res.write(d); } });
    if (!r.ok && !ac.signal.aborted) res.write(`\n\n**Error:** ${r.message}`);
    res.end(); return text;
  }
  try {
    const { c, betas } = await client();
    const stream = c.beta.messages.stream({ ...req(s, messages, extra), betas }, { signal: ac.signal });
    for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { text += ev.delta.text; res.write(ev.delta.text); }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') res.write('\n\n*(Claude declined this request.)*');
  } catch (e) { if (!ac.signal.aborted) res.write(`\n\n**Error:** ${e.message}`); }
  res.end(); return text;
}
// opts.web: allow web search (real links); opts.signal: abort when the client goes away
const json = (s, prompt, extra, opts) => timed(`json ${prompt.slice(0, 40).replace(/\s+/g, ' ')}…`, s, () => json0(s, prompt, extra, opts));
async function json0(s, prompt, extra, opts = {}) {
  let text;
  if (useCli()) {
    const { system, pdf } = context(s);
    const r = await cli.stream({ system, messages: [{ role: 'user', content: prompt }], model: settings().model || 'claude-opus-5', pdf, web: opts.web, signal: opts.signal });
    if (!r.ok) throw new Error(r.message); text = r.text;
  } else {
    const { c, betas } = await client();
    const web = opts.web ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }] } : {};
    const r = await c.beta.messages.create({ ...req(s, [{ role: 'user', content: prompt }], { ...web, ...extra }), betas }, { signal: opts.signal });
    text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  return require('./jsonish').parse(text); // tolerant: prose around the JSON, raw quotes inside strings
}

// ---------- studies ----------
app.get('/api/studies', (req, res) => res.json(fs.readdirSync(STUDIES).map(study).filter(s => !s.general).sort((a, b) => b.updatedAt - a.updatedAt)
  .map(({ id, title, subject, hasPdf, updatedAt, quizzes }) => ({ id, title, subject, hasPdf, updatedAt, quizzes: quizzes.length }))));
app.get('/api/pick-pdf', async (req, res) => {
  if (!app.pickPdf) return res.json({ error: 'Browsing for a file needs the desktop app.' });
  try { const file = await app.pickPdf(); res.json(file ? { file } : { canceled: true }); } catch (e) { res.json({ error: `File picker failed: ${e.message}` }); }
});
app.post('/api/studies', (req, res) => {
  const { title, subject, pdfPath } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (pdfPath && fs.statSync(pdfPath).size > 30e6) return res.status(400).json({ error: 'PDF over 30 MB' });
  const s = { id: Date.now().toString(36), title: title.trim(), subject: (subject || '').trim(), hasPdf: !!pdfPath, createdAt: Date.now(), updatedAt: Date.now(), chat: [], interviews: [], quizzes: [], challenges: [] };
  fs.mkdirSync(path.join(STUDIES, s.id));
  if (pdfPath) fs.copyFileSync(pdfPath, path.join(STUDIES, s.id, 'source.pdf'));
  save(s); res.json(s);
});
// every session of one kind across studies, newest first, tagged with its study (the grid tools)
for (const kind of ['interviews', 'challenges']) app.get(`/api/${kind}`, (req, res) => res.json(fs.readdirSync(STUDIES).map(study).flatMap(s => (s[kind] || []).map(i => ({ ...i, studyId: s.id, studyTitle: s.title }))).sort((a, b) => b.at - a.at)));
app.get('/api/studies/:id', (req, res) => { try { res.json(study(req.params.id)); } catch { res.status(404).json({ error: 'no such study' }); } });
app.delete('/api/studies/:id', (req, res) => { fs.rmSync(path.join(STUDIES, req.params.id), { recursive: true }); res.json({ ok: true }); });
const touch = s => { s.updatedAt = Date.now(); save(s); };

// ---------- profile + dashboard + coach ----------
const PROFILE = path.join(DATA, 'profile.json'), COACH = path.join(DATA, 'coach.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
app.get('/api/profile', (req, res) => res.json(readJson(PROFILE, null) || {}));
app.post('/api/profile', (req, res) => {
  const keep = ['name', 'career', 'goal', 'hoursPerWeek', 'notes', 'examDate', 'examName'], p = { ...(readJson(PROFILE, {})), updatedAt: Date.now() };
  for (const k of keep) if (k in req.body) p[k] = k === 'hoursPerWeek' ? Math.max(1, Math.min(80, +req.body[k] || 5)) : k === 'examDate' ? (/^\d{4}-\d{2}-\d{2}$/.test(req.body[k] || '') ? req.body[k] : '') : String(req.body[k] || '').slice(0, 400);
  fs.writeFileSync(PROFILE, JSON.stringify(p)); res.json(p);
});
const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// every timed session of a study as one event; score is 0..1 or null
function events(s) {
  const ev = [];
  for (const q of s.quizzes) ev.push({ kind: 'quiz', id: q.id, title: q.title, at: q.at, secs: q.elapsed || 0, done: q.status === 'graded' || (!q.questions && q.score != null), score: q.score != null && q.total ? q.score / q.total : null });
  for (const i of s.interviews || []) ev.push({ kind: 'interview', id: i.id, title: i.mode === 'real' ? `${ROUNDS[i.round] || i.round} interview · ${i.role}` : `${i.difficulty} interview · ${i.language}`, at: i.at, secs: i.elapsed || 0, done: i.status === 'ended', score: i.turns.length ? i.turns.reduce((a, t) => a + (t.score || 0), 0) / i.turns.length / 10 : null, n: i.turns.length });
  for (const c of s.challenges) ev.push({ kind: 'code', id: c.id, title: c.title, at: c.at, secs: c.elapsed || 0, done: c.status !== 'open', score: c.passed != null && c.total ? c.passed / c.total : null });
  return ev.map(e => ({ ...e, studyId: s.id, study: s.title }));
}
function dashboard() {
  const all = fs.readdirSync(STUDIES).map(study), evs = all.flatMap(events).sort((a, b) => b.at - a.at);
  const studies = all.map(s => {
    const ev = events(s), scored = ev.filter(e => e.score != null), by = k => ev.filter(e => e.kind === k);
    return { id: s.id, general: !!s.general, title: s.title, subject: s.subject, hasPdf: s.hasPdf, updatedAt: s.updatedAt, createdAt: s.createdAt, minutes: Math.round(ev.reduce((a, e) => a + e.secs, 0) / 60),
      sessions: ev.length, open: ev.filter(e => !e.done).map(e => e.kind), avg: scored.length ? Math.round(scored.reduce((a, e) => a + e.score, 0) / scored.length * 100) : null,
      lastAt: Math.max(s.updatedAt, ...ev.map(e => e.at)), questions: s.chat.length >> 1, quizzes: by('quiz').length, interviews: by('interview').length, challenges: by('code').length,
      weak: scored.filter(e => e.score < 0.6).slice(0, 3).map(e => e.title), goal: s.goal || null };
  }).filter(s => !s.general).sort((a, b) => b.lastAt - a.lastAt); // General practice counts in events and streaks, not as a study
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return { day: localDay(d), minutes: 0 }; });
  for (const e of evs) { const d = days.find(x => x.day === localDay(e.at)); if (d) d.minutes += e.secs / 60; } // ponytail: whole session credited to its start day
  days.forEach(d => d.minutes = Math.round(d.minutes));
  const active = new Set(evs.map(e => localDay(e.at))); let streak = 0; const d = new Date(); if (!active.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (active.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  return { studies, events: evs.slice(0, 12), days, streak, weekMinutes: days.reduce((a, x) => a + x.minutes, 0), totalMinutes: Math.round(evs.reduce((a, e) => a + e.secs, 0) / 60), lastAt: evs[0]?.at || studies[0]?.lastAt || null };
}
app.get('/api/dashboard', (req, res) => res.json(dashboard()));
// AI coach: what to study next, to-dos, tips, subjects to add. Cached until the stats or profile change.
const NO_STUDY = { id: '_', title: 'Dashboard', subject: "the learner's overall progress across all studies" };
app.post('/api/coach', async (req, res) => {
  const p = readJson(PROFILE, {}), d = dashboard();
  const key = JSON.stringify([p.updatedAt, d.streak, d.studies.map(s => [s.id, s.sessions, s.avg, s.minutes, s.goal?.kind, s.goal?.target])]);
  const cached = readJson(COACH, null);
  if (!req.body?.force && cached?.key === key) return res.json({ ...cached.plan, at: cached.at, cached: true });
  const stats = d.studies.map(s => `- ${s.title} (id ${s.id})${s.subject ? `: ${s.subject}` : ''} · ${s.minutes} min · ${s.interviews} interviews, ${s.challenges} challenges, ${s.questions} questions asked · avg score ${s.avg ?? 'n/a'}% · open sessions: ${s.open.join(', ') || 'none'} · last ${Math.round((Date.now() - s.lastAt) / 864e5)} days ago${s.weak.length ? ` · weak: ${s.weak.join('; ')}` : ''}`).join('\n') || '(no studies yet)';
  const prompt = `You are the learner's personal study coach. Learner: ${p.name || 'unknown name'}. Current role / background: ${p.career || 'not given'}. Goal: ${p.goal || 'not given'}. Target: ${p.hoursPerWeek || 5} hours/week. Notes from them: ${p.notes || 'none'}.
Today: ${localDay(Date.now())}. Streak: ${d.streak} days. This week: ${d.weekMinutes} minutes. Total: ${d.totalMinutes} minutes.
${app.locals.coachContext?.() || ''}
Studies:\n${stats}\nRecent sessions:\n${d.events.slice(0, 8).map(e => `- ${localDay(e.at)} ${e.kind} "${e.title}" in ${e.study}: ${e.score == null ? 'not scored' : Math.round(e.score * 100) + '%'}${e.done ? '' : ' (unfinished)'}`).join('\n') || '- none'}
The tools that exist are: interview (adaptive oral exam), code challenge, review (spaced-repetition flashcards and missed questions) and ask (chat about the material). There is no quiz tool; never suggest a quiz. Never mention ids in any text field (use studyId fields for that). Be concrete and honest; base advice on the numbers (weak scores, neglected studies, unfinished sessions, gap between goal and what they study). Address them by first name. Respond with ONLY JSON: {"headline": string (one motivating line, max 12 words), "next": {"studyId": string|null, "title": string, "why": string (1-2 lines), "tool": "interview"|"code"|"ask"|"review"|"new", "topic": string}, "todos": [4-6 of {"text": string, "tool": "interview"|"code"|"ask"|"review"|"new", "studyId": string|null}], "tips": [3 short concrete tips to get better, each mentioning a specific study or habit], "suggestNew": [2-3 of {"title": string, "subject": string (one-line scope), "why": string}] (subjects worth adding given their goal), "nudge": string (one-line reminder to keep going)}`;
  try { const plan = await json(NO_STUDY, prompt); fs.writeFileSync(COACH, JSON.stringify({ key, at: Date.now(), plan })); res.json({ ...plan, at: Date.now() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- notes (same semantics as aidle's notes:* IPC handlers) ----------
const tree = import('./src/core/notesTree.mjs'); // ESM shared with the renderer; ponytail: one dynamic import, awaited per call
// notes are global, not per study. Until the global file exists, reads fold in the old per-study notes.json files.
const NOTES = path.join(DATA, 'notes.json');
const loadNotes = () => { try { return JSON.parse(fs.readFileSync(NOTES, 'utf8')); } catch { return fs.readdirSync(STUDIES).flatMap(id => { try { return JSON.parse(fs.readFileSync(path.join(STUDIES, id, 'notes.json'), 'utf8')); } catch { return []; } }); } };
const saveNotes = (_, notes) => fs.writeFileSync(NOTES, JSON.stringify(notes));
app.post('/api/notes/list', async (req, res) => {
  try { const { migrateGroups } = await tree; const { notes, changed } = migrateGroups(loadNotes(req.params.id), req.body.extraFolders || []); if (changed) saveNotes(req.params.id, notes); res.json({ ok: true, notes }); }
  catch (e) { res.json({ ok: false, message: e.message, notes: [] }); }
});
app.post('/api/notes/save', (req, res) => {
  try {
    const notes = loadNotes(req.params.id), note = req.body.note, now = Date.now();
    const i = notes.findIndex(n => n.id === note.id), merged = { ...note, updatedAt: now, createdAt: note.createdAt || now };
    if (i >= 0) notes[i] = merged; else notes.unshift(merged);
    saveNotes(req.params.id, notes); res.json({ ok: true, note: merged });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/notes/reorder', (req, res) => {
  try {
    const notes = loadNotes(req.params.id), byId = new Map(notes.map(n => [n.id, n]));
    const ordered = (req.body.ids || []).map(id => byId.get(id)).filter(Boolean), seen = new Set(ordered.map(n => n.id));
    saveNotes(req.params.id, [...ordered, ...notes.filter(n => !seen.has(n.id))]); res.json({ ok: true });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/notes/delete', async (req, res) => {
  try { const { removeNote } = await tree; const notes = removeNote(loadNotes(req.params.id), req.body.id); saveNotes(req.params.id, notes); res.json({ ok: true, notes }); }
  catch (e) { res.json({ ok: false, message: e.message }); }
});
app.post('/api/notes/export', async (req, res) => res.json(app.exportNote ? await app.exportNote(req.body) : { ok: false, message: 'Export needs the desktop app.' }));
app.post('/api/show-in-folder', (req, res) => { app.showInFolder?.(req.body.path); res.json({ ok: true }); });

// ---------- ask ----------
app.post('/api/studies/:id/chat', async (req, res) => {
  const s = study(req.params.id);
  s.chat.push({ role: 'user', content: req.body.message });
  const text = await streamText(res, s, s.chat, s.hasPdf ? { system: `${context(s).system}\n\nWhen part of an answer comes from the PDF, cite the page inline as (p. N), using the PDF's page number.` } : undefined);
  s.chat.push({ role: 'assistant', content: text || '*(stopped)*' }); touch(s); // never store an empty turn: the API rejects empty content
});
// ---------- the study's PDF and its chapter list ----------
app.get('/api/studies/:id/source.pdf', (req, res) => { const f = path.join(STUDIES, path.basename(req.params.id), 'source.pdf'); if (fs.existsSync(f)) res.sendFile(f); else res.status(404).end(); });
// PDF bookmarks via mutool: lines like `+\t\t"Binary search"\t#page=22&zoom=…`, one tab per level
const bookmarks = f => new Promise(r => {
  let out = ''; const p = spawn('mutool', ['show', f, 'outline']);
  p.stdout.on('data', d => out += d); p.on('error', () => r([]));
  p.on('close', () => r(out.split('\n').map(l => /^[|+](\t+)"(.*)"\t#page=(\d+)/.exec(l)).filter(Boolean).map(m => ({ title: m[2].replace(/\\"/g, '"'), page: +m[3], depth: m[1].length - 1 }))));
});
// cached on the study; a PDF without bookmarks (or no mutool) gets its contents read once by Claude
app.get('/api/studies/:id/outline', async (req, res) => {
  let s; try { s = study(path.basename(req.params.id)); } catch { return res.status(404).json({ error: 'no such study' }); }
  const f = path.join(STUDIES, s.id, 'source.pdf'); if (!fs.existsSync(f)) return res.status(404).json({ error: 'This study has no PDF.' });
  if (s.outline && !req.query.refresh) return res.json(s.outline);
  try {
    let items = await bookmarks(f), from = 'bookmarks';
    if (!items.length) {
      from = 'ai';
      const r = await json(s, 'List the table of contents of the attached PDF: every chapter, and the main sections inside each. For each, give the page number in the PDF file where it starts (1-based index of the page in the file, not the printed page label). Respond with ONLY JSON: {"items": [{"title": string, "page": number, "depth": 0 for a chapter, 1 for a section}]}');
      items = (r.items || []).filter(x => x.title && +x.page > 0).map(x => ({ title: String(x.title).slice(0, 200), page: Math.round(+x.page), depth: Math.min(2, Math.max(0, Math.round(+x.depth) || 0)) }));
    }
    const s2 = study(s.id); s2.outline = { at: Date.now(), from, items }; save(s2); res.json(s2.outline);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/studies/:id/chat',(req, res) => { const s = study(req.params.id); s.chat = []; touch(s); res.json({ ok: true }); });

// Quiz was removed (the interview covers it). Past quiz records stay in study.json: they still count in stats, review cards and exports.
// ---------- interview (endless wizard: one question at a time, graded, next question built on the answers) ----------
const findIv = (s, iid) => (s.interviews ||= []).find(i => i.id === iid);
const nextQ = n => ({ q: n.q, type: n.type === 'choice' && n.choices?.length ? 'choice' : 'text', choices: n.choices || null, answerIndex: n.answer ?? null, ...(n.topic ? { topic: String(n.topic).slice(0, 60) } : {}), ...(n.followUp ? { followUp: true } : {}) });
// Real interview (General practice): one round type for a target role, open answers only, follow-ups, rubric grading.
const ROUNDS = { technical: 'Technical', behavioral: 'Behavioral', situational: 'Situational', management: 'Management', 'system-design': 'System design', architecture: 'Architecture' };
const RUBRICS = {
  technical: ['Correctness', 'Depth', 'Trade-offs', 'Clarity'],
  behavioral: ['Situation & task', 'Actions', 'Result & impact', 'Ownership', 'Clarity'],
  situational: ['Judgment', 'Prioritization', 'Stakeholders', 'Communication'],
  management: ['People leadership', 'Delivery', 'Conflict handling', 'Strategy', 'Communication'],
  'system-design': ['Requirements', 'High-level design', 'Scalability', 'Trade-offs', 'Communication'],
  architecture: ['Requirements', 'Architecture choices', 'Non-functional needs', 'Trade-offs', 'Communication'],
};
const ROUND_GUIDE = {
  technical: 'Probe real knowledge for the role: concepts, how things work under the hood, debugging, trade-offs. Mix breadth and depth.',
  behavioral: 'Ask "Tell me about a time…" questions on competencies (ownership, conflict, failure, influence, delivery). Expect STAR answers; follow up on vague parts, the candidate\'s own actions and measurable results.',
  situational: 'Pose realistic hypothetical workplace scenarios for the role ("What would you do if…"). Follow up by changing the constraints.',
  management: 'Cover hiring, growing and managing people, underperformers, prioritization, delivery under pressure and cross-team influence, calibrated to the seniority.',
  'system-design': 'Run ONE design problem as a staged interview: 1) clarify requirements and scale, 2) API and data model, 3) high-level components, 4) deep dive on a bottleneck, 5) scaling, failure modes and trade-offs. Move to the next stage only once the current one is covered; stay on the same problem for the whole interview.',
  architecture: 'Run an architecture discussion on ONE realistic system for the role: context and constraints, architecture style, integration and data flow, non-functional requirements (security, reliability, cost, evolvability), then decisions and trade-offs. Stay on the same system across stages.',
};
// Arabic is spoken Egyptian colloquial: formal فصحى sounds stiff read aloud, and real Egyptian interviewers mix in English tech terms
const langRule = l => /arab/i.test(l) ? 'Language: Egyptian colloquial Arabic (عامية مصرية). Talk like a real Egyptian interviewer, in a natural spoken style, not formal فصحى and never like a news anchor: short sentences, everyday words, and now and then a natural filler where a person would pause (يعني، طيب، بص، خلينا نشوف). Keep technical terms (API, cache, database, deployment…) in English. Write every question, choice and feedback this way.' : `Language: ${l}. Write every question, choice and feedback in ${l}.`;
// interviewer manner, picked when the round starts
const PERSONAS = {
  friendly: 'Your manner: warm and encouraging. Put them at ease and react kindly, but still probe for depth.\n',
  neutral: 'Your manner: professional and neutral, like most real interviewers. Polite and focused, with no hints about how they are doing.\n',
  tough: 'Your manner: demanding and fast-paced, like a bar-raiser. Short reactions, sharp follow-ups on anything vague, push on trade-offs and numbers. Never rude.\n',
};
// ---------- STAR story bank: the candidate's prepared stories, used by behavioral-style rounds and their coaching ----------
const STORIES = path.join(DATA, 'stories.json');
const loadStories = () => readJson(STORIES, []);
app.get('/api/stories', (req, res) => res.json(loadStories()));
app.post('/api/stories', (req, res) => {
  const b = req.body || {}, list = loadStories(), clip = (v, n) => String(v || '').trim().slice(0, n);
  const st = { id: clip(b.id, 40) || Date.now().toString(36), title: clip(b.title, 120), situation: clip(b.situation, 1500), task: clip(b.task, 1500), action: clip(b.action, 2500), result: clip(b.result, 1500),
    skills: (Array.isArray(b.skills) ? b.skills : String(b.skills || '').split(',')).map(x => clip(x, 40)).filter(Boolean).slice(0, 8), updatedAt: Date.now() };
  if (!st.title) return res.status(400).json({ error: 'Give the story a title.' });
  const i = list.findIndex(x => x.id === st.id); if (i >= 0) list[i] = st; else list.unshift(st);
  fs.writeFileSync(STORIES, JSON.stringify(list)); res.json(st);
});
app.delete('/api/stories/:sid', (req, res) => { fs.writeFileSync(STORIES, JSON.stringify(loadStories().filter(x => x.id !== req.params.sid))); res.json({ ok: true }); });
const storiesFor = iv => {
  const L = ['behavioral', 'situational', 'management'].includes(iv.round) ? loadStories() : [];
  return L.length ? `The candidate prepared these STAR stories. Now and then ask them to walk you through one that fits, and probe it like a real interviewer (their own part, the numbers, what they would do differently):\n${L.slice(0, 12).map(x => `- "${x.title}"${x.skills.length ? ` (${x.skills.join(', ')})` : ''}: ${cut(x.situation, 160)} → ${cut(x.result, 120)}`).join('\n')}\n` : '';
};
const realBase = iv => `You are interviewing a candidate in a real ${ROUNDS[iv.round] || iv.round} interview round for the role "${iv.role}" at ${iv.seniority} level. ${langRule(iv.language)}
${ROUND_GUIDE[iv.round] || ROUND_GUIDE.technical}
${PERSONAS[iv.persona] || ''}${storiesFor(iv)}${iv.jd ? `The job description they are interviewing for:\n<job_description>\n${iv.jd}\n</job_description>\nTailor the questions to it.\n` : ''}${iv.turns.length ? `Transcript so far:\n${iv.turns.map((t, i) => `Q${i + 1}${t.followUp ? ' (follow-up)' : ''}${t.topic ? ` [${t.topic}]` : ''}: ${t.q}\nCandidate: ${t.answer}\nScore: ${t.score}/10`).join('\n\n')}\n\n` : ''}`;
const ivBase = iv => iv.mode === 'real' ? realBase(iv) : `You are running an endless oral-exam style interview on the study material. Difficulty: ${iv.difficulty}. ${langRule(iv.language)}${iv.focus ? ` Ask only about ${iv.focus.title}${iv.focus.from ? ` (PDF pages ${iv.focus.from}${iv.focus.to ? `-${iv.focus.to}` : ' onwards'})` : ''}.` : ''}
${iv.turns.length ? `Transcript so far:\n${iv.turns.map((t, i) => `Q${i + 1} (${t.type}): ${t.q}\nLearner: ${t.answer}\nVerdict: ${t.correct ? 'correct' : 'wrong'} (${t.score}/10)`).join('\n\n')}\n\n` : ''}`;
// Two separate calls: grading is what the learner waits for; the next question is fetched behind the feedback.
const hintNote = p => p.hint ? `\nBefore answering they asked for a hint and got: "${p.hint}". Take 2 points off the overall score for needing it, and mention that in the feedback.` : '';
const gradePrompt = (iv, answer) => iv.mode === 'real' ? `${ivBase(iv)}Current question: ${iv.pending.q}${hintNote(iv.pending)}\nThe candidate answered: ${answer || '(no answer)'}\n\nGrade it the way a calibrated interviewer for a ${iv.seniority} ${iv.role} would. Feedback in 3-6 lines: what landed, what was missing or weak, and what a strong ${iv.seniority}-level answer would include. Score each rubric criterion 0-10: ${RUBRICS[iv.round].join(', ')}. Respond with ONLY JSON: {"feedback": string, "score": number 0-10 overall, "rubric": {${RUBRICS[iv.round].map(k => `"${k}": number`).join(', ')}}}`
  : `${ivBase(iv)}Current question (${iv.pending.type}): ${iv.pending.q}${hintNote(iv.pending)}${iv.pending.choices ? `\nChoices: ${iv.pending.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join(' | ')}\nCorrect choice: ${'ABCD'[iv.pending.answerIndex] || '?'}` : ''}\nThe learner answered: ${answer || '(no answer)'}\n\nGrade this answer honestly: feedback in 2-4 lines (what was right, what was missing, the ideal answer), correct true/false, score 0-10. Respond with ONLY JSON: {"feedback": string, "correct": boolean, "score": number}`;
const followUps = iv => { let n = 0; for (let i = iv.turns.length - 1; i >= 0 && iv.turns[i].followUp; i--) n++; return n; };
const nextPrompt = iv => iv.mode === 'real' ? `${ivBase(iv)}${iv.turns.length ? `Ask your next question like a real interviewer. If the last answer was vague, shallow, missing a key point or made a claim worth testing, ask a follow-up that digs into it (followUp true)${followUps(iv) >= 2 ? '; you already followed up twice on this thread, so move on to a new topic now' : ''}. Otherwise move to a new topic or the next stage. Never repeat a question.` : 'Open the round with your first question (a one-line greeting before it is fine).'} Talk as in a live conversation: you may open with a very short natural reaction to their last answer (a few words, like «تمام، حلو» or "Got it") that never reveals whether it was right, then ask the question. No grading, no hints, no multiple choice. Respond with ONLY JSON: {"q": string, "followUp": boolean, "topic": short label of what this question assesses}`
  : `${ivBase(iv)}Write the next question, building on the transcript: go deeper where the learner is strong, revisit gaps, never repeat a question. Speak to the learner as "you" and just ask the question: no preamble, no commentary on their previous answers, no explanation of why you chose it. Type "choice" (4 choices, exactly one correct) or "text" (short open answer, explain-it-to-me style); alternate the two types${iv.turns.length ? ` (last was ${iv.turns[iv.turns.length - 1].type})` : ''}. Respond with ONLY JSON: {"q": string, "type": "choice"|"text", "choices": [4 strings]|null, "answer": correct index|null}`;
app.post('/api/studies/:id/interviews', async (req, res) => {
  const s = study(req.params.id); const { difficulty = 'medium', language = 'English', round, role, seniority = 'mid' } = req.body;
  const iv = { id: Date.now().toString(36), at: Date.now(), difficulty: String(difficulty).slice(0, 20), language: String(language).slice(0, 30), status: 'open', elapsed: 0, turns: [], pending: null };
  if (s.general) { // real interview: a round type for a target role; difficulty mirrors seniority for the older views
    if (!RUBRICS[round]) return res.status(400).json({ error: 'unknown round' });
    if (!String(role || '').trim()) return res.status(400).json({ error: 'Say which role you are interviewing for.' });
    Object.assign(iv, { mode: 'real', round, role: String(role).trim().slice(0, 80), seniority: String(seniority).slice(0, 20), difficulty: String(seniority).slice(0, 20), jd: String(req.body.jd || '').trim().slice(0, 6000), persona: PERSONAS[req.body.persona] ? req.body.persona : 'neutral' });
  } else if (req.body.focus?.title) iv.focus = { title: String(req.body.focus.title).slice(0, 160), from: Math.round(+req.body.focus.from) || null, to: Math.round(+req.body.focus.to) || null };
  try { iv.pending = nextQ(await json(s, nextPrompt(iv))); (s.interviews ||= []).push(iv); touch(s); res.json(iv); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// answer the pending question: grade only (fast); the next question is a separate call
app.post('/api/studies/:id/interviews/:iid/answer', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv?.pending) return res.status(404).json({ error: 'no open question' });
  const { answer = '', picked = null, secs = 0, elapsed } = req.body, d = req.body.delivery;
  const delivery = d && typeof d === 'object' ? Object.fromEntries(['secs', 'words', 'wpm', 'fillers', 'longPauses'].map(k => [k, Math.max(0, Math.round(+d[k] || 0))])) : null; // measured from the mic
  try {
    const r = await json(s, gradePrompt(iv, answer)), g = graded(iv, r);
    iv.turns.push({ ...iv.pending, answer, picked, secs, feedback: r.feedback || '', ...g, ...(delivery ? { delivery } : {}), at: Date.now() });
    iv.pending = null; if (elapsed != null) iv.elapsed = elapsed; touch(s); res.json(iv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ---------- around the interview: hints, the panel's hire decision, a strong model answer, answering a question again ----------
const graded = (iv, r) => {
  const score = Math.max(0, Math.min(10, Math.round(+r.score || 0)));
  const rubric = iv.mode === 'real' && r.rubric ? Object.fromEntries(RUBRICS[iv.round].filter(k => Number.isFinite(+r.rubric[k]) && r.rubric[k] !== null && r.rubric[k] !== '').map(k => [k, Math.max(0, Math.min(10, Math.round(+r.rubric[k])))])) : undefined;
  return { score, correct: iv.mode === 'real' ? score >= 6 : !!r.correct, ...(rubric ? { rubric } : {}) };
};
// write back into a fresh read: these calls take a while and the session may have been saved meanwhile
const reread = (req, fn) => { const s2 = study(req.params.id), iv2 = findIv(s2, req.params.iid); if (!iv2) return null; fn(iv2); save(s2); return iv2; };
app.post('/api/studies/:id/interviews/:iid/hint', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv?.pending) return res.status(404).json({ error: 'no open question' });
  if (iv.pending.hint) return res.json(iv);
  try {
    const r = await json(s, `${ivBase(iv)}Current question: ${iv.pending.q}\nThe candidate asked for a hint. Give one short nudge (one sentence), the way a real interviewer would: point them in a direction without giving the answer away. Respond with ONLY JSON: {"hint": string}`);
    const out = reread(req, iv2 => { if (iv2.pending?.q === iv.pending.q) iv2.pending.hint = String(r.hint || '').slice(0, 400); });
    out ? res.json(out) : res.status(404).json({ error: 'no such interview' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const VERDICTS = ['strong_hire', 'hire', 'lean_hire', 'lean_no_hire', 'no_hire'];
app.post('/api/studies/:id/interviews/:iid/verdict', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv) return res.status(404).json({ error: 'no such interview' });
  if (!iv.turns.length) return res.status(400).json({ error: 'Answer at least one question first.' });
  try {
    const r = await json(s, `${ivBase(iv)}The round is over. Decide the way a real hiring panel for a ${iv.seniority || ''} ${iv.role || 'candidate'} would, based only on the transcript. Be honest and calibrated: a single round rarely earns strong_hire, and short or vague answers are a no. Respond with ONLY JSON: {"verdict": ${VERDICTS.map(v => `"${v}"`).join('|')}, "summary": string (one or two sentences, as the panel would put it), "reasons": [2-4 short strings: the evidence behind the decision], "toPass": [1-3 short strings: what would change the decision next time]}`);
    const out = reread(req, iv2 => { iv2.verdict = { verdict: VERDICTS.includes(r.verdict) ? r.verdict : 'lean_no_hire', summary: String(r.summary || ''), reasons: (r.reasons || []).map(String).slice(0, 4), toPass: (r.toPass || []).map(String).slice(0, 3), turns: iv.turns.length, at: Date.now() }; });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const turnOf = (req, res) => { const s = study(req.params.id), iv = findIv(s, req.params.iid), t = iv?.turns[+req.params.i]; if (!t) res.status(404).json({ error: 'no such answer' }); return { s, iv, t, i: +req.params.i }; };
app.post('/api/studies/:id/interviews/:iid/turns/:i/model', async (req, res) => {
  const { s, iv, t, i } = turnOf(req, res); if (!t) return;
  if (t.model) return res.json(iv);
  try {
    const r = await json(s, `${ivBase({ ...iv, turns: iv.turns.slice(0, i) })}Question: ${t.q}\n${iv.mode === 'real'
      ? `Write the answer a strong ${iv.seniority} ${iv.role} candidate would say out loud in the room: first person, natural spoken style, about 120-220 words${iv.round === 'behavioral' ? ', as a STAR story' : ''}. It should score 9-10 on: ${RUBRICS[iv.round].join(', ')}.`
      : 'Write the ideal answer a top student would say out loud: clear, complete and concise, 60-150 words.'} Respond with ONLY JSON: {"answer": string}`);
    res.json(reread(req, iv2 => { if (iv2.turns[i]) iv2.turns[i].model = String(r.answer || ''); }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/studies/:id/interviews/:iid/turns/:i/retry', async (req, res) => {
  const { s, iv, t, i } = turnOf(req, res); if (!t) return;
  const answer = String(req.body?.answer || '').trim().slice(0, 8000);
  if (!answer) return res.status(400).json({ error: 'Say or type your new answer first.' });
  try {
    const r = await json(s, gradePrompt({ ...iv, turns: iv.turns.slice(0, i), pending: { ...t, hint: null } }, answer)), g = graded(iv, r);
    res.json(reread(req, iv2 => { if (iv2.turns[i]) (iv2.turns[i].retries ||= []).push({ answer, score: g.score, feedback: String(r.feedback || ''), ...(g.rubric ? { rubric: g.rubric } : {}), at: Date.now() }); }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// next question: idempotent, so the client can prefetch it while feedback is on screen
app.post('/api/studies/:id/interviews/:iid/next', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv) return res.status(404).json({ error: 'no such interview' });
  if (iv.pending) return res.json(iv);
  try { iv.pending = nextQ(await json(s, nextPrompt(iv))); touch(s); res.json(iv); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// progress autosave: elapsed, status (open ↔ ended — an ended session can always be resumed)
app.post('/api/studies/:id/interviews/:iid', (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv) return res.status(404).json({ error: 'no such interview' });
  if ('elapsed' in req.body) iv.elapsed = +req.body.elapsed || 0;
  if (['open', 'ended'].includes(req.body.status)) iv.status = req.body.status;
  save(s); res.json({ ok: true });
});
// ---------- coaching reports: analysis + learning resources found by web search ----------
// Every link is verified by linkcheck.js before it is saved; unverifiable ones are dropped. Verified links are
// cached on the study (s.linkCache), offered back to the model on the next report, and not re-fetched while fresh.
const cut = (t, n = 220) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
const searchRules = (avoid, known) => `Use web search to find real, currently available learning resources that fix this learner's weak spots (if they did well, resources that take them deeper). Copy every URL exactly from a search result; never guess or build a URL.${known.length ? `
These resources were already verified for this study. Reuse any that fit these weak spots (copy the URL exactly) and search only for what they do not cover:
${known.map(k => `- [${k.kind}] ${k.title} ${k.url}`).join('\n')}` : ''}${avoid.length ? `
These URLs did not work, do not use them: ${avoid.join(' ')}` : ''}`;
const reportShape = lang => `Include at least 3 YouTube videos, 2 YouTube playlists, 2 GitHub repositories and 2 online quizzes or practice question sets, then any strong articles. Prefer resources in ${lang} when good ones exist, otherwise English.
Respond with ONLY JSON: {"summary": string (2-3 lines), "level": "strong"|"solid"|"developing"|"struggling", "strengths": [strings], "weaknesses": [strings, each a specific concept they got wrong], "tips": [4-6 concrete, actionable steps to improve], "resources": [10-14 of {"kind": "video"|"playlist"|"repo"|"quiz"|"article", "title": string, "url": string, "why": string (one line: which weakness it fixes)}]}`;
const reportPrompt = (iv, avoid = [], known = []) => `${ivBase(iv)}The interview is over. Coach this learner honestly, based only on the transcript above.
${searchRules(avoid, known)}
${reportShape(iv.language)}`;
const studyPrompt = (s, avoid = [], known = []) => {
  const ivs = (s.interviews || []).filter(i => i.turns?.length), lang = ivs[ivs.length - 1]?.language || 'English';
  const turns = ivs.flatMap(i => i.turns.map(t => ({ ...t, d: i.difficulty }))).slice(-60), chs = (s.challenges || []).filter(c => c.statement).slice(-15);
  return `You are a study coach reviewing everything this learner has done in the study "${s.title}"${s.subject ? ` (${s.subject})` : ''}. Write every text field in ${lang}.
Interview answers across ${ivs.length} interview${ivs.length === 1 ? '' : 's'}, oldest first:
${turns.map((t, i) => `${i + 1}. [${t.d}] Q: ${cut(t.q)} | Learner: ${cut(t.answer) || '(no answer)'} | ${t.correct ? 'correct' : 'wrong'} ${t.score}/10`).join('\n') || '(none)'}
Coding challenges:
${chs.map(c => `- ${cut(c.title, 80)} (${c.difficulty}, ${c.language}): ${c.status}, tests passed ${c.passed ?? '?'}/${c.total}`).join('\n') || '(none)'}
Coach this learner honestly across all of it: name weak topics that keep coming back across sessions, say what improved over time, and what to study next.
${searchRules(avoid, known)}
${reportShape(lang)}`;
};
// one report: ask (with one retry on broken JSON), verify links through the cache, retry once for missing links
async function coachReport(s, prompt, signal) {
  const cache = pruneCache(s.linkCache), known = Object.values(pruneCache(cache, 20)).map(v => v.rec);
  const ask = avoid => json(s, prompt(avoid, known), undefined, { web: true, signal }).catch(e => e instanceof SyntaxError && !signal.aborted
    ? json(s, `${prompt(avoid, known)}\nYour previous reply was not valid JSON. Escape every double quote inside strings.`, undefined, { web: true, signal }) : Promise.reject(e));
  const r = await ask();
  let resources = await verify(r.resources, cache), asked = (r.resources || []).length;
  if (resources.length < 6 && !signal.aborted) { // one retry for the gaps, told which links failed
    const bad = (r.resources || []).map(x => x.url).filter(u => !resources.some(v => v.url === u));
    const more = await ask(bad);
    asked += (more.resources || []).length; resources = await verify([...resources, ...(more.resources || [])], cache);
  }
  return { report: { at: Date.now(), summary: String(r.summary || ''), level: r.level || '', strengths: r.strengths || [], weaknesses: r.weaknesses || [], tips: r.tips || [], resources, dropped: Math.max(0, asked - resources.length) }, cache };
}
const abortOnClose = res => { const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); }); return ac; };
const reportError = (res, ac, e) => { if (!ac.signal.aborted) res.status(500).json({ error: e instanceof SyntaxError ? 'The coach reply came back garbled twice. Try again.' : e.message }); };
const mergeCache = (s2, cache) => { s2.linkCache = pruneCache({ ...(s2.linkCache || {}), ...cache }); };

app.post('/api/studies/:id/interviews/:iid/report', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv) return res.status(404).json({ error: 'no such interview' });
  if (!iv.turns.length) return res.status(400).json({ error: 'Answer at least one question first.' });
  const ac = abortOnClose(res);
  try {
    const { report, cache } = await coachReport(s, (avoid, known) => reportPrompt(iv, avoid, known), ac.signal);
    if (ac.signal.aborted) return;
    const s2 = study(req.params.id), iv2 = findIv(s2, req.params.iid); if (!iv2) return res.status(404).json({ error: 'no such interview' }); // re-read: minutes passed, keep other saves
    iv2.report = { ...report, turns: iv.turns.length }; mergeCache(s2, cache); touch(s2); res.json(iv2);
  } catch (e) { reportError(res, ac, e); }
});
// study-wide coaching: every interview answer and coding challenge in the study, saved as s.report
app.post('/api/studies/:id/report', async (req, res) => {
  let s; try { s = study(req.params.id); } catch { return res.status(404).json({ error: 'no such study' }); }
  const answered = (s.interviews || []).reduce((a, i) => a + (i.turns?.length || 0), 0), challenges = (s.challenges || []).filter(c => c.statement).length;
  if (!answered && !challenges) return res.status(400).json({ error: 'Do an interview or a coding challenge in this study first.' });
  const ac = abortOnClose(res);
  try {
    const { report, cache } = await coachReport(s, (avoid, known) => studyPrompt(s, avoid, known), ac.signal);
    if (ac.signal.aborted) return;
    const s2 = study(req.params.id); s2.report = { ...report, answered, challenges }; mergeCache(s2, cache); touch(s2); res.json({ report: s2.report });
  } catch (e) { reportError(res, ac, e); }
});
app.delete('/api/studies/:id/interviews/:iid', (req, res) => { const s = study(req.params.id); s.interviews = (s.interviews || []).filter(i => i.id !== req.params.iid); touch(s); res.json({ ok: true }); });

// ---------- code challenges ----------
// Languages: write to a temp dir, compile once (if needed), run every test against the binary.
// ponytail: add a language = one line here + one entry in CodeArena.jsx LANGS.
const LANGS = {
  javascript: { file: 'main.js', run: d => ['node', [`${d}/main.js`]] },
  typescript: { file: 'main.ts', run: d => ['node', [`${d}/main.ts`]] }, // Node 24 strips types natively
  python: { file: 'main.py', run: d => ['python3', [`${d}/main.py`]] },
  php: { file: 'main.php', run: d => ['php', [`${d}/main.php`]] },
  java: { file: 'Main.java', build: d => ['javac', ['-d', d, `${d}/Main.java`]], run: d => ['java', ['-cp', d, 'Main']], note: 'The class must be `public class Main`.' },
  cpp: { file: 'main.cpp', build: d => ['g++', ['-O2', '-std=c++17', '-o', `${d}/a.out`, `${d}/main.cpp`]], run: d => [`${d}/a.out`, []] },
  // C#: dotnet needs a project, so one console project is created once under DATA and reused (build is incremental).
  csharp: { file: 'Program.cs', cached: true, build: d => ['dotnet', ['build', d, '-c', 'Release', '--nologo', '-v', 'q']], run: d => ['dotnet', [`${d}/bin/Release/net8.0/${path.basename(d)}.dll`]], note: 'Top-level statements are fine (no class needed); target .NET 8.' },
  rust: { file: 'main.rs', build: d => ['rustc', ['-O', '-o', `${d}/a.out`, `${d}/main.rs`]], run: d => [`${d}/a.out`, []] },
};
const LIMITS = { easy: 15, medium: 30, hard: 45 }; // suggested minutes
const findCh = (s, cid) => s.challenges.find(c => c.id === cid);
async function makeChallenge(s, { language = 'javascript', difficulty = 'medium', topic = '' }, lead = '') {
  const c = await json(s, `${lead ? `${lead}\n\n` : ''}Create one HackerRank-style coding challenge ${s.general ? `of the kind asked in real coding interviews, on ${topic ? `this topic: ${topic}` : 'a classic data structures and algorithms topic of your choice'}` : `that exercises the study material${topic ? ` (topic: ${topic})` : ''}`}. Difficulty: ${difficulty}. Language: ${language}. ${LANGS[language].note || ''} The program is a single file that reads ALL input from stdin and prints the answer to stdout. Give 5 tests with exact stdin and exact expected stdout (trailing newline optional). Starter code must read stdin and contain a TODO. Respond with ONLY JSON: {"title": string, "statement": markdown string with problem, input format, output format, constraints, "examples": [{"input": string, "output": string, "explanation": string}], "starter": string, "tests": [{"input": string, "output": string}]}`);
  Object.assign(c, { id: Date.now().toString(36), at: Date.now(), topic: String(topic).slice(0, 80), language, difficulty, limitMin: LIMITS[difficulty] || 30, code: c.starter, chat: [], elapsed: 0, status: 'open', passed: null, total: c.tests.length });
  s.challenges.push(c); touch(s); return c;
}
app.post('/api/studies/:id/challenge', async (req, res) => {
  const s = study(req.params.id);
  if (!LANGS[req.body.language || 'javascript']) return res.status(400).json({ error: 'unsupported language' });
  try { res.json(await makeChallenge(s, req.body)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// progress autosave: code, elapsed, status, passed
app.post('/api/studies/:id/challenge/:cid', (req, res) => {
  const s = study(req.params.id), c = findCh(s, req.params.cid); if (!c) return res.status(404).json({ error: 'no such challenge' });
  for (const k of ['code', 'elapsed', 'status', 'passed']) if (k in req.body) c[k] = req.body[k];
  save(s); res.json({ ok: true });
});
app.delete('/api/studies/:id/challenge/:cid', (req, res) => { const s = study(req.params.id); s.challenges = s.challenges.filter(c => c.id !== req.params.cid); touch(s); res.json({ ok: true }); });
const exec = (cmd, args, input, timeout = 5000) => new Promise(r => {
  let out = '', err = '';
  const p = spawn(cmd, args, { timeout });
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', code => r({ out: out.trim(), err: err.trim().slice(-800), code }));
  p.on('error', e => r({ out: '', err: e.message, code: -1 }));
  p.stdin.end(input);
});
app.post('/api/run', async (req, res) => {
  const { language, code, tests = [] } = req.body; const L = LANGS[language];
  if (!L) return res.status(400).json({ error: 'unsupported language' });
  const csDir = path.join(DATA, 'csrun');
  if (L.cached && !fs.existsSync(path.join(csDir, 'csrun.csproj'))) { const n = await exec('dotnet', ['new', 'console', '-o', csDir, '--force'], '', 120000); if (n.code !== 0) return res.json({ error: 'dotnet new failed: ' + n.err }); }
  const dir = L.cached ? csDir : fs.mkdtempSync(path.join(os.tmpdir(), 'cram-run-'));
  try {
    fs.writeFileSync(path.join(dir, L.file), code);
    if (L.build) { const b = await exec(...L.build(dir), '', 60000); if (b.code !== 0) { const msg = (b.err || b.out || 'compile failed').split('\n').filter(l => /error|warning|\^|:\d+/.test(l) || l.trim()).slice(0, 12).join('\n'); return res.json({ results: tests.map(t => ({ ...t, out: '', err: msg, code: b.code, pass: false })), passed: 0, compileError: msg }); } }
    const results = [];
    for (const t of tests) { const r = await exec(...L.run(dir), t.input); results.push({ ...t, ...r, pass: r.out === t.output.trim() }); }
    res.json({ results, passed: results.filter(r => r.pass).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (!L.cached) fs.rmSync(dir, { recursive: true, force: true }); }
});
const chCtx = (c, code, results) => `## Challenge: ${c.title} (${c.language}, ${c.difficulty})\n${c.statement}\n\nTests (stdin → expected stdout):\n${c.tests.map((t, i) => `${i + 1}. ${JSON.stringify(t.input)} → ${JSON.stringify(t.output)}`).join('\n')}\n\n## The learner's current code\n\`\`\`${c.language}\n${code}\n\`\`\`\n\n## Latest test run\n${results ? `${results.passed}/${results.results.length} passed.\n${results.results.map((r, i) => `Test ${i + 1}: ${r.pass ? 'PASS' : `FAIL (expected ${JSON.stringify(r.output)}, got ${JSON.stringify(r.out)}${r.err ? `, stderr: ${r.err}` : ''})`}`).join('\n')}` : 'Not run yet.'}`;
// Coach chat: sees the challenge + live code; nudges, doesn't hand over the solution unless asked outright.
app.post('/api/studies/:id/challenge/:cid/chat', async (req, res) => {
  const s = study(req.params.id), c = findCh(s, req.params.cid); if (!c) return res.status(404).end();
  const { message, code, results } = req.body;
  c.chat.push({ role: 'user', content: message });
  const text = await streamText(res, s, c.chat, { system: `${context(s).system}\n\nYou are coaching the learner through a coding challenge. Be Socratic: hints, questions, pointers to the exact bug or edge case, small snippets at most. Give the full solution only if they explicitly ask for it. Keep replies short.\n\n${chCtx(c, code ?? c.code, results)}` });
  c.chat.push({ role: 'assistant', content: text || '*(stopped)*' }); c.code = code ?? c.code; save(s); // Stop before any text: never store an empty turn
});
app.post('/api/studies/:id/challenge/:cid/review', async (req, res) => {
  const s = study(req.params.id), c = findCh(s, req.params.cid); if (!c) return res.status(404).end();
  const { code, results } = req.body;
  await streamText(res, s, [{ role: 'user', content: `Review my solution. Give: correctness verdict, bugs or edge cases missed, time/space complexity, ${s.general ? 'how an interviewer would judge it,' : 'how it relates to the study material,'} and a cleaner reference solution. Be direct.\n\n${chCtx(c, code, results)}` }]);
  c.code = code; if (results) { c.passed = results.passed; if (results.passed === results.results.length) c.status = 'solved'; } touch(s);
});

require('./reminderStore')(app, { DATA });
require('./features')(app, { study, save, touch, json, context, DATA, STUDIES, PROFILE, COACH, NO_STUDY, readJson, localDay, events, loadNotes, saveNotes, makeChallenge });

module.exports = app;
if (require.main === module) app.listen(3000, '127.0.0.1', () => console.log('http://localhost:3000'));
