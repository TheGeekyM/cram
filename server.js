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
// one line per Claude call: what, which provider/model, then how long it took
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[claude]', ...a);
const timed = async (what, s, fn) => { const t = Date.now(); log(`${what} start · ${useCli() ? 'cli' : auth.signedIn() ? 'oauth' : 'api'} · ${settings().model || 'claude-opus-5'} · pdf=${s.hasPdf ? 'yes' : 'no'}`); try { return await fn(); } finally { log(`${what} done in ${((Date.now() - t) / 1000).toFixed(1)}s`); } };

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
const json = (s, prompt, extra) => timed(`json ${prompt.slice(0, 40).replace(/\s+/g, ' ')}…`, s, () => json0(s, prompt, extra));
async function json0(s, prompt, extra) {
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
for (const kind of ['quizzes', 'interviews', 'challenges']) app.get(`/api/${kind}`, (req, res) => res.json(fs.readdirSync(STUDIES).map(study).flatMap(s => (s[kind] || []).map(i => ({ ...i, studyId: s.id, studyTitle: s.title }))).sort((a, b) => b.at - a.at)));
app.get('/api/studies/:id', (req, res) => { try { res.json(study(req.params.id)); } catch { res.status(404).json({ error: 'no such study' }); } });
app.delete('/api/studies/:id', (req, res) => { fs.rmSync(path.join(STUDIES, req.params.id), { recursive: true }); res.json({ ok: true }); });
const touch = s => { s.updatedAt = Date.now(); save(s); };

// ---------- profile + dashboard + coach ----------
const PROFILE = path.join(DATA, 'profile.json'), COACH = path.join(DATA, 'coach.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
app.get('/api/profile', (req, res) => res.json(readJson(PROFILE, null) || {}));
app.post('/api/profile', (req, res) => {
  const keep = ['name', 'career', 'goal', 'hoursPerWeek', 'notes'], p = { ...(readJson(PROFILE, {})), updatedAt: Date.now() };
  for (const k of keep) if (k in req.body) p[k] = k === 'hoursPerWeek' ? Math.max(1, Math.min(80, +req.body[k] || 5)) : String(req.body[k] || '').slice(0, 400);
  fs.writeFileSync(PROFILE, JSON.stringify(p)); res.json(p);
});
const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// every timed session of a study as one event; score is 0..1 or null
function events(s) {
  const ev = [];
  for (const q of s.quizzes) ev.push({ kind: 'quiz', id: q.id, title: q.title, at: q.at, secs: q.elapsed || 0, done: q.status === 'graded' || (!q.questions && q.score != null), score: q.score != null && q.total ? q.score / q.total : null });
  for (const i of s.interviews || []) ev.push({ kind: 'interview', id: i.id, title: `${i.difficulty} interview · ${i.language}`, at: i.at, secs: i.elapsed || 0, done: i.status === 'ended', score: i.turns.length ? i.turns.reduce((a, t) => a + (t.score || 0), 0) / i.turns.length / 10 : null, n: i.turns.length });
  for (const c of s.challenges) ev.push({ kind: 'code', id: c.id, title: c.title, at: c.at, secs: c.elapsed || 0, done: c.status !== 'open', score: c.passed != null && c.total ? c.passed / c.total : null });
  return ev.map(e => ({ ...e, studyId: s.id, study: s.title }));
}
function dashboard() {
  const all = fs.readdirSync(STUDIES).map(study), evs = all.flatMap(events).sort((a, b) => b.at - a.at);
  const studies = all.map(s => {
    const ev = events(s), scored = ev.filter(e => e.score != null), by = k => ev.filter(e => e.kind === k);
    return { id: s.id, title: s.title, subject: s.subject, hasPdf: s.hasPdf, updatedAt: s.updatedAt, createdAt: s.createdAt, minutes: Math.round(ev.reduce((a, e) => a + e.secs, 0) / 60),
      sessions: ev.length, open: ev.filter(e => !e.done).map(e => e.kind), avg: scored.length ? Math.round(scored.reduce((a, e) => a + e.score, 0) / scored.length * 100) : null,
      lastAt: Math.max(s.updatedAt, ...ev.map(e => e.at)), questions: s.chat.length >> 1, quizzes: by('quiz').length, interviews: by('interview').length, challenges: by('code').length,
      weak: scored.filter(e => e.score < 0.6).slice(0, 3).map(e => e.title) };
  }).sort((a, b) => b.lastAt - a.lastAt);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return { day: localDay(d), minutes: 0 }; });
  for (const e of evs) { const d = days.find(x => x.day === localDay(e.at)); if (d) d.minutes += e.secs / 60; } // ponytail: whole session credited to its start day
  days.forEach(d => d.minutes = Math.round(d.minutes));
  const active = new Set(evs.map(e => localDay(e.at))); let streak = 0; const d = new Date(); if (!active.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (active.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  return { studies, events: evs.slice(0, 12), days, streak, weekMinutes: days.reduce((a, x) => a + x.minutes, 0), totalMinutes: studies.reduce((a, s) => a + s.minutes, 0), lastAt: evs[0]?.at || studies[0]?.lastAt || null };
}
app.get('/api/dashboard', (req, res) => res.json(dashboard()));
// AI coach: what to study next, to-dos, tips, subjects to add. Cached until the stats or profile change.
const NO_STUDY = { id: '_', title: 'Dashboard', subject: "the learner's overall progress across all studies" };
app.post('/api/coach', async (req, res) => {
  const p = readJson(PROFILE, {}), d = dashboard();
  const key = JSON.stringify([p.updatedAt, d.streak, d.studies.map(s => [s.id, s.sessions, s.avg, s.minutes])]);
  const cached = readJson(COACH, null);
  if (!req.body?.force && cached?.key === key) return res.json({ ...cached.plan, at: cached.at, cached: true });
  const stats = d.studies.map(s => `- ${s.title} (id ${s.id})${s.subject ? `: ${s.subject}` : ''} · ${s.minutes} min · ${s.quizzes} quizzes, ${s.interviews} interviews, ${s.challenges} challenges, ${s.questions} questions asked · avg score ${s.avg ?? 'n/a'}% · open sessions: ${s.open.join(', ') || 'none'} · last ${Math.round((Date.now() - s.lastAt) / 864e5)} days ago${s.weak.length ? ` · weak: ${s.weak.join('; ')}` : ''}`).join('\n') || '(no studies yet)';
  const prompt = `You are the learner's personal study coach. Learner: ${p.name || 'unknown name'}. Current role / background: ${p.career || 'not given'}. Goal: ${p.goal || 'not given'}. Target: ${p.hoursPerWeek || 5} hours/week. Notes from them: ${p.notes || 'none'}.
Today: ${localDay(Date.now())}. Streak: ${d.streak} days. This week: ${d.weekMinutes} minutes. Total: ${d.totalMinutes} minutes.
Studies:\n${stats}\nRecent sessions:\n${d.events.slice(0, 8).map(e => `- ${localDay(e.at)} ${e.kind} "${e.title}" in ${e.study}: ${e.score == null ? 'not scored' : Math.round(e.score * 100) + '%'}${e.done ? '' : ' (unfinished)'}`).join('\n') || '- none'}
Never mention ids in any text field (use studyId fields for that). Be concrete and honest; base advice on the numbers (weak scores, neglected studies, unfinished sessions, gap between goal and what they study). Address them by first name. Respond with ONLY JSON: {"headline": string (one motivating line, max 12 words), "next": {"studyId": string|null, "title": string, "why": string (1-2 lines), "tool": "quiz"|"interview"|"code"|"ask"|"new", "topic": string}, "todos": [4-6 of {"text": string, "tool": "quiz"|"interview"|"code"|"ask"|"new", "studyId": string|null}], "tips": [3 short concrete tips to get better, each mentioning a specific study or habit], "suggestNew": [2-3 of {"title": string, "subject": string (one-line scope), "why": string}] (subjects worth adding given their goal), "nudge": string (one-line reminder to keep going)}`;
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
  const text = await streamText(res, s, s.chat);
  s.chat.push({ role: 'assistant', content: text || '*(stopped)*' }); touch(s); // never store an empty turn: the API rejects empty content
});
app.delete('/api/studies/:id/chat', (req, res) => { const s = study(req.params.id); s.chat = []; touch(s); res.json({ ok: true }); });

// ---------- quiz (persisted: answers, timer and grade are saved so a quiz can be resumed or reviewed) ----------
const findQz = (s, qid) => s.quizzes.find(q => q.id === qid);
app.post('/api/studies/:id/quiz', async (req, res) => {
  const s = study(req.params.id); const { n = 8, difficulty = 'mixed', topic = '' } = req.body;
  try {
    const q = await json(s, `Write a ${n}-question multiple-choice quiz on the study material${topic ? ` focused on: ${topic}` : ''}. Difficulty: ${difficulty}. Cover different parts of the material, avoid trivia. Respond with ONLY JSON: {"title": string, "questions": [{"q": string, "choices": [4 strings], "answer": index 0-3, "explanation": string}]}`);
    Object.assign(q, { id: Date.now().toString(36), at: Date.now(), difficulty, topic, status: 'open', picked: Array(q.questions.length).fill(-1), elapsed: 0, score: null, total: q.questions.length });
    s.quizzes.push(q); touch(s); res.json(q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// progress autosave: picked, elapsed, status, score
app.post('/api/studies/:id/quiz/:qid', (req, res) => {
  const s = study(req.params.id), q = findQz(s, req.params.qid); if (!q) return res.status(404).json({ error: 'no such quiz' });
  for (const k of ['picked', 'elapsed', 'status', 'score']) if (k in req.body) q[k] = req.body[k];
  save(s); res.json({ ok: true });
});
app.delete('/api/studies/:id/quiz/:qid', (req, res) => { const s = study(req.params.id); s.quizzes = s.quizzes.filter(q => q.id !== req.params.qid); touch(s); res.json({ ok: true }); });

// ---------- interview (endless wizard: one question at a time, graded, next question built on the answers) ----------
const findIv = (s, iid) => (s.interviews ||= []).find(i => i.id === iid);
const nextQ = n => ({ q: n.q, type: n.type === 'choice' && n.choices?.length ? 'choice' : 'text', choices: n.choices || null, answerIndex: n.answer ?? null });
const ivBase = iv => `You are running an endless oral-exam style interview on the study material. Difficulty: ${iv.difficulty}. Language: ${iv.language}. Write every question, choice and feedback in ${iv.language}.
${iv.turns.length ? `Transcript so far:\n${iv.turns.map((t, i) => `Q${i + 1} (${t.type}): ${t.q}\nLearner: ${t.answer}\nVerdict: ${t.correct ? 'correct' : 'wrong'} (${t.score}/10)`).join('\n\n')}\n\n` : ''}`;
// Two separate calls: grading is what the learner waits for; the next question is fetched behind the feedback.
const gradePrompt = (iv, answer) => `${ivBase(iv)}Current question (${iv.pending.type}): ${iv.pending.q}${iv.pending.choices ? `\nChoices: ${iv.pending.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join(' | ')}\nCorrect choice: ${'ABCD'[iv.pending.answerIndex] || '?'}` : ''}\nThe learner answered: ${answer || '(no answer)'}\n\nGrade this answer honestly: feedback in 2-4 lines (what was right, what was missing, the ideal answer), correct true/false, score 0-10. Respond with ONLY JSON: {"feedback": string, "correct": boolean, "score": number}`;
const nextPrompt = iv => `${ivBase(iv)}Write the next question, building on the transcript: go deeper where the learner is strong, revisit gaps, never repeat a question. Speak to the learner as "you" and just ask the question: no preamble, no commentary on their previous answers, no explanation of why you chose it. Type "choice" (4 choices, exactly one correct) or "text" (short open answer, explain-it-to-me style); alternate the two types${iv.turns.length ? ` (last was ${iv.turns[iv.turns.length - 1].type})` : ''}. Respond with ONLY JSON: {"q": string, "type": "choice"|"text", "choices": [4 strings]|null, "answer": correct index|null}`;
app.post('/api/studies/:id/interviews', async (req, res) => {
  const s = study(req.params.id); const { difficulty = 'medium', language = 'English' } = req.body;
  const iv = { id: Date.now().toString(36), at: Date.now(), difficulty: String(difficulty).slice(0, 20), language: String(language).slice(0, 30), status: 'open', elapsed: 0, turns: [], pending: null };
  try { iv.pending = nextQ(await json(s, nextPrompt(iv))); (s.interviews ||= []).push(iv); touch(s); res.json(iv); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// answer the pending question: grade only (fast); the next question is a separate call
app.post('/api/studies/:id/interviews/:iid/answer', async (req, res) => {
  const s = study(req.params.id), iv = findIv(s, req.params.iid); if (!iv?.pending) return res.status(404).json({ error: 'no open question' });
  const { answer = '', picked = null, secs = 0, elapsed } = req.body;
  try {
    const r = await json(s, gradePrompt(iv, answer));
    iv.turns.push({ ...iv.pending, answer, picked, secs, feedback: r.feedback || '', correct: !!r.correct, score: +r.score || 0, at: Date.now() });
    iv.pending = null; if (elapsed != null) iv.elapsed = elapsed; touch(s); res.json(iv);
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
  csharp: { file: 'Program.cs', extra: { 'main.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>disable</Nullable><TreatWarningsAsErrors>false</TreatWarningsAsErrors></PropertyGroup></Project>' },
    build: d => ['dotnet', ['build', d, '-c', 'Release', '-o', `${d}/out`, '-nologo', '-v', 'q']], run: d => ['dotnet', [`${d}/out/main.dll`]], note: 'Use top-level statements (no namespace/class needed) and Console.In / Console.Out.' },
};
const LIMITS = { easy: 15, medium: 30, hard: 45 }; // suggested minutes
const findCh = (s, cid) => s.challenges.find(c => c.id === cid);
app.post('/api/studies/:id/challenge', async (req, res) => {
  const s = study(req.params.id); const { language = 'javascript', difficulty = 'medium', topic = '' } = req.body;
  if (!LANGS[language]) return res.status(400).json({ error: 'unsupported language' });
  try {
    const c = await json(s, `Create one HackerRank-style coding challenge that exercises the study material${topic ? ` (topic: ${topic})` : ''}. Difficulty: ${difficulty}. Language: ${language}. ${LANGS[language].note || ''} The program is a single file that reads ALL input from stdin and prints the answer to stdout. Give 5 tests with exact stdin and exact expected stdout (trailing newline optional). Starter code must read stdin and contain a TODO. Respond with ONLY JSON: {"title": string, "statement": markdown string with problem, input format, output format, constraints, "examples": [{"input": string, "output": string, "explanation": string}], "starter": string, "tests": [{"input": string, "output": string}]}`);
    Object.assign(c, { id: Date.now().toString(36), at: Date.now(), language, difficulty, limitMin: LIMITS[difficulty] || 30, code: c.starter, chat: [], elapsed: 0, status: 'open', passed: null, total: c.tests.length });
    s.challenges.push(c); touch(s); res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    for (const [f, body] of Object.entries(L.extra || {})) fs.writeFileSync(path.join(dir, f), body);
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
  c.chat.push({ role: 'assistant', content: text }); c.code = code ?? c.code; save(s);
});
app.post('/api/studies/:id/challenge/:cid/review', async (req, res) => {
  const s = study(req.params.id), c = findCh(s, req.params.cid); if (!c) return res.status(404).end();
  const { code, results } = req.body;
  await streamText(res, s, [{ role: 'user', content: `Review my solution. Give: correctness verdict, bugs or edge cases missed, time/space complexity, how it relates to the study material, and a cleaner reference solution. Be direct.\n\n${chCtx(c, code, results)}` }]);
  c.code = code; if (results) { c.passed = results.passed; if (results.passed === results.results.length) c.status = 'solved'; } touch(s);
});

module.exports = app;
if (require.main === module) app.listen(3000, '127.0.0.1', () => console.log('http://localhost:3000'));
