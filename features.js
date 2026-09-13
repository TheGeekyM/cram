// Study features mounted on top of server.js: review queue (spaced repetition over missed quiz and
// interview answers, plus generated flashcards), per-study goals, weekly report, plan board, export
// to Notes, adaptive next coding challenge, offline daily reminder. server.js passes its helpers in.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { marked } = require('marked');

const DAY = 864e5;
const STEPS = [1, 3, 7, 14, 30, 60, 120]; // review intervals, days
const GRADES = ['again', 'hard', 'good', 'easy'];
// again resets (and counts a lapse), hard repeats the step, good advances one, easy skips one
function schedule(card, grade, now = Date.now()) {
  const cur = card.step ?? -1;
  const step = Math.min(STEPS.length - 1, grade === 'again' ? 0 : grade === 'hard' ? Math.max(0, cur) : grade === 'easy' ? cur + 2 : cur + 1);
  return { ...card, step, dueAt: now + STEPS[step] * DAY, reps: (card.reps || 0) + 1, lapses: (card.lapses || 0) + (grade === 'again' ? 1 : 0), lastAt: now, lastGrade: grade };
}
const GOAL_KINDS = { avg: 'average score %', minutes: 'minutes studied', sessions: 'sessions' };
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = t => String(t ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

module.exports = (app, ctx) => {
  const { study, save, touch, json, DATA, STUDIES, PROFILE, COACH, NO_STUDY, readJson, localDay, events, loadNotes, saveNotes, makeChallenge } = ctx;
  const file = n => path.join(DATA, n);
  const write = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v));
  const allStudies = () => fs.readdirSync(STUDIES).map(id => { try { return study(id); } catch { return null; } }).filter(Boolean);
  const findStudy = (req, res) => { try { return study(req.params.id); } catch { res.status(404).json({ error: 'no such study' }); return null; } };

  // ---------- review queue ----------
  const loadReview = () => readJson(file('review.json'), { cards: [], seen: [] });
  // Every missed quiz question and failed interview turn enters the queue once; `seen` keeps deleted ones out.
  function sync() {
    const r = loadReview(), seen = new Set(r.seen), now = Date.now(); let added = 0;
    const add = (key, card) => { if (seen.has(key)) return; seen.add(key); r.cards.push({ id: key.replace(/\W/g, '-'), key, step: -1, reps: 0, lapses: 0, createdAt: now, ...card }); added++; };
    for (const s of allStudies()) {
      for (const q of s.quizzes || []) if (q.status === 'graded' && q.questions) q.questions.forEach((x, i) => {
        if (q.picked?.[i] !== x.answer) add(`quiz:${q.id}:${i}`, { studyId: s.id, source: 'quiz', q: x.q, choices: x.choices, answerIndex: x.answer, a: x.explanation || '', dueAt: (q.at || now) + DAY });
      });
      for (const iv of s.interviews || []) (iv.turns || []).forEach((t, i) => {
        if (!t.correct) add(`iv:${iv.id}:${i}`, { studyId: s.id, source: 'interview', q: t.q, choices: t.type === 'choice' ? t.choices : null, answerIndex: t.type === 'choice' ? t.answerIndex : null, a: t.feedback || '', dueAt: (t.at || iv.at || now) + DAY });
      });
    }
    r.seen = [...seen]; if (added) write('review.json', r);
    return r;
  }
  app.get('/api/review', (req, res) => {
    const r = sync(), titles = Object.fromEntries(allStudies().map(s => [s.id, s.title])), now = Date.now();
    const cards = r.cards.filter(c => titles[c.studyId]).map(c => ({ ...c, studyTitle: titles[c.studyId] })).sort((a, b) => a.dueAt - b.dueAt);
    res.json({ cards, due: cards.filter(c => c.dueAt <= now).length, steps: STEPS });
  });
  app.post('/api/review/:id', (req, res) => {
    if (!GRADES.includes(req.body?.grade)) return res.status(400).json({ error: `grade must be one of ${GRADES.join(', ')}` });
    const r = loadReview(), i = r.cards.findIndex(c => c.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'no such card' });
    r.cards[i] = schedule(r.cards[i], req.body.grade); write('review.json', r); res.json(r.cards[i]);
  });
  app.delete('/api/review/:id', (req, res) => { const r = loadReview(); r.cards = r.cards.filter(c => c.id !== req.params.id); write('review.json', r); res.json({ ok: true }); });
  app.post('/api/studies/:id/flashcards', async (req, res) => {
    const s = findStudy(req, res); if (!s) return;
    const n = Math.max(3, Math.min(30, +req.body?.n || 10)), topic = String(req.body?.topic || '').slice(0, 200);
    try {
      const r = await json(s, `Write ${n} flashcards on the study material${topic ? ` focused on: ${topic}` : ''}. Each card tests one idea worth remembering: a definition, a distinction, a why, a trade-off or a key fact. The front is a short question. The back answers it in 1-3 sentences. No trivia, no duplicates. Respond with ONLY JSON: {"cards": [{"q": string, "a": string}]}`);
      const now = Date.now(), rv = loadReview();
      const added = (r.cards || []).filter(c => c.q && c.a).map((c, i) => ({ id: `card-${now.toString(36)}-${i}`, key: `card:${now}:${i}`, studyId: s.id, source: 'card', q: c.q, a: c.a, choices: null, answerIndex: null, step: -1, reps: 0, lapses: 0, createdAt: now, dueAt: now }));
      rv.cards.push(...added); write('review.json', rv); touch(s);
      res.json({ added: added.map(c => ({ ...c, studyTitle: s.title })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- per-study goal ----------
  app.post('/api/studies/:id/goal', (req, res) => {
    const s = findStudy(req, res); if (!s) return;
    const { kind, target } = req.body || {};
    s.goal = GOAL_KINDS[kind] && +target > 0 ? { kind, target: Math.round(+target) } : null;
    save(s); res.json({ goal: s.goal });
  });

  // ---------- extra coach context: exam, goals, review queue, the learner's own notes ----------
  app.locals.coachContext = () => {
    const p = readJson(PROFILE, {}), r = loadReview(), now = Date.now();
    const days = p.examDate ? Math.ceil((new Date(`${p.examDate}T00:00`) - now) / DAY) : null;
    const goals = allStudies().filter(s => s.goal).map(s => `- ${s.title}: goal ${s.goal.target} ${GOAL_KINDS[s.goal.kind]}`);
    let notes = [];
    try { notes = loadNotes().filter(n => strip(n.content)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8).map(n => `- "${n.title || 'Untitled'}": ${strip(n.content).slice(0, 280)}`); } catch {}
    return [
      p.examDate && `Exam${p.examName ? ` "${p.examName}"` : ''} on ${p.examDate}: ${days >= 0 ? `${days} days from today. Pace the plan to it.` : 'already passed.'}`,
      goals.length && `Per-study goals:\n${goals.join('\n')}`,
      `Review queue: ${r.cards.filter(c => c.dueAt <= now).length} cards due now of ${r.cards.length}, ${r.cards.reduce((a, c) => a + (c.lapses || 0), 0)} lapses so far. Use tool "review" when cards are due.`,
      notes.length && `Their most recent notes, in their own words (shows what they understood):\n${notes.join('\n')}`,
    ].filter(Boolean).join('\n');
  };

  // ---------- weekly report: last full Monday-Sunday week vs the one before, generated once per week ----------
  const weekKey = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localDay(d); };
  function weekStats(from, to) {
    const evs = allStudies().flatMap(events).filter(e => e.at >= from && e.at < to), scored = evs.filter(e => e.score != null), per = {};
    for (const e of evs) per[e.study] = (per[e.study] || 0) + e.secs / 60;
    return { minutes: Math.round(evs.reduce((a, e) => a + e.secs, 0) / 60), sessions: evs.length, avg: scored.length ? Math.round(scored.reduce((a, e) => a + e.score, 0) / scored.length * 100) : null,
      perStudy: Object.entries(per).map(([k, v]) => `${k} ${Math.round(v)} min`).join(', ') || 'none',
      list: evs.slice(0, 25).map(e => `- ${localDay(e.at)} ${e.kind} "${e.title}" (${e.study})${e.score == null ? '' : ` ${Math.round(e.score * 100)}%`}`) };
  }
  app.get('/api/report', (req, res) => { const all = readJson(file('reports.json'), {}), k = weekKey(); res.json({ week: k, report: all[k] || null }); });
  app.post('/api/report', async (req, res) => {
    const all = readJson(file('reports.json'), {}), k = weekKey();
    if (all[k] && !req.body?.force) return res.json({ week: k, report: all[k] });
    const start = new Date(`${k}T00:00`).getTime(), last = weekStats(start - 7 * DAY, start), prev = weekStats(start - 14 * DAY, start - 7 * DAY), p = readJson(PROFILE, {});
    const prompt = `Write the weekly study report for ${p.name ? p.name.split(' ')[0] : 'the learner'} for the week ending ${localDay(start - DAY)}. Their goal: ${p.goal || 'not given'}. Target: ${p.hoursPerWeek || 5} hours/week.
Last week: ${last.minutes} min, ${last.sessions} sessions, average score ${last.avg ?? 'n/a'}%. Per study: ${last.perStudy}.
${last.list.join('\n') || '- no sessions'}
The week before: ${prev.minutes} min, ${prev.sessions} sessions, average score ${prev.avg ?? 'n/a'}%. Per study: ${prev.perStudy}.
${app.locals.coachContext()}
The tools that exist are: interview (adaptive oral exam), code challenge, review (spaced-repetition flashcards and missed questions) and ask (chat about the material). There is no quiz tool; never suggest a quiz. Compare the two weeks honestly and use the numbers. If last week had no study, say so plainly and make the focus a small restart. Address them by first name. Never mention ids. Respond with ONLY JSON: {"summary": string (2 sentences), "improved": [0-3 strings], "slipped": [0-3 strings], "focus": string (one concrete focus for this week)}`;
    try {
      const r = await json(NO_STUDY, prompt);
      all[k] = { ...r, stats: { minutes: last.minutes, sessions: last.sessions, avg: last.avg, prevMinutes: prev.minutes, prevSessions: prev.sessions, prevAvg: prev.avg }, at: Date.now() };
      write('reports.json', all); res.json({ week: k, report: all[k] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- plan board: to-dos placed on days ----------
  const TOOLS = ['ask', 'quiz', 'interview', 'code', 'review', 'notes'];
  app.get('/api/plan', (req, res) => res.json({ items: readJson(file('plan.json'), []), coach: readJson(COACH, null)?.plan?.todos || [] }));
  app.post('/api/plan', (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 500).map(x => ({
      id: String(x.id || Math.random().toString(36).slice(2)), text: String(x.text || '').slice(0, 300), tool: TOOLS.includes(x.tool) ? x.tool : '',
      studyId: x.studyId ? String(x.studyId) : null, day: /^\d{4}-\d{2}-\d{2}$/.test(x.day || '') ? x.day : null, done: !!x.done,
    })).filter(x => x.text);
    write('plan.json', items); res.json({ items });
  });

  // ---------- export a study's practice to a note (Notes stores TipTap HTML) ----------
  app.post('/api/studies/:id/export-notes', (req, res) => {
    const s = findStudy(req, res); if (!s) return;
    const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const quote = t => t ? `> ${esc(t).replace(/\n/g, '\n> ')}` : '';
    const md = [];
    for (const q of (s.quizzes || []).filter(q => q.questions)) {
      md.push(`## Quiz: ${esc(q.title)}`, `${day(q.at)} · ${q.difficulty} · ${q.status === 'graded' ? `score ${q.score}/${q.total}` : 'not graded yet'}`);
      q.questions.forEach((x, i) => { const p = q.picked?.[i]; md.push(`**${i + 1}. ${esc(x.q)}**`, x.choices.map((c, j) => `- ${j === x.answer ? '✅' : j === p ? '❌' : '·'} ${esc(c)}${j === p ? ' *(your pick)*' : ''}`).join('\n'), quote(x.explanation)); });
    }
    for (const iv of (s.interviews || []).filter(i => i.turns?.length)) {
      md.push(`## Interview: ${iv.difficulty} · ${iv.language}`, `${day(iv.at)} · ${iv.turns.length} questions · average ${Math.round(iv.turns.reduce((a, t) => a + (t.score || 0), 0) / iv.turns.length)}/10`);
      iv.turns.forEach((t, i) => md.push(`**Q${i + 1}. ${esc(t.q)}** (${t.score}/10)`, `Your answer: ${esc(t.answer) || '*no answer*'}`, quote(t.feedback)));
    }
    for (const c of (s.challenges || []).filter(c => c.statement)) md.push(`## Challenge: ${esc(c.title)}`, `${day(c.at)} · ${c.language} · ${c.difficulty} · ${c.status} · ${c.passed ?? 0}/${c.total} tests`, `\`\`\`${c.language}\n${c.code || ''}\n\`\`\``);
    if (!md.length) return res.status(400).json({ error: 'Nothing to export yet: this study has no quizzes, interviews or challenges.' });
    const now = Date.now(), note = { id: `export-${now.toString(36)}`, title: `${s.title} · practice log`, content: marked.parse([`*Exported from Cram on ${day(now)}.*`, ...md].filter(Boolean).join('\n\n')), parent: '', createdAt: now, updatedAt: now };
    const notes = loadNotes(); notes.unshift(note); saveNotes(null, notes);
    res.json({ ok: true, note: { id: note.id, title: note.title } });
  });

  // ---------- adaptive next challenge: harder after a solve, a focused smaller one after a miss ----------
  app.post('/api/studies/:id/challenge/:cid/next', async (req, res) => {
    const s = findStudy(req, res); if (!s) return;
    const c = (s.challenges || []).find(x => x.id === req.params.cid); if (!c) return res.status(404).json({ error: 'no such challenge' });
    const { code = c.code, results } = req.body || {};
    const passed = results ? results.passed : c.passed, solved = c.status === 'solved' || (!!results && results.passed === results.results.length);
    const fails = results ? results.results.filter(r => !r.pass).slice(0, 3).map(r => `stdin ${JSON.stringify(r.input)} expected ${JSON.stringify(r.output)} got ${JSON.stringify(r.out)}${r.err ? ` stderr ${JSON.stringify(String(r.err).slice(0, 200))}` : ''}`).join('\n') : '';
    const LEVELS = ['easy', 'medium', 'hard'], li = Math.max(0, LEVELS.indexOf(c.difficulty));
    const difficulty = solved ? LEVELS[Math.min(2, li + 1)] : !passed ? LEVELS[Math.max(0, li - 1)] : c.difficulty;
    const why = solved
      ? `The learner solved "${c.title}" (${c.difficulty}). Write the next step up: the same core concept with one new twist or constraint that forces a better approach.`
      : `The learner has not solved "${c.title}" (${passed ?? 0}/${c.total} tests${c.status === 'given-up' ? ', gave up' : ''}). Their code:\n\`\`\`${c.language}\n${String(code || '').slice(0, 4000)}\n\`\`\`\n${fails ? `Failing tests:\n${fails}\n` : ''}Diagnose the concept they are missing from the code and the failures, then write a smaller challenge that isolates exactly that concept, so solving it unlocks the original.`;
    try {
      const n = await makeChallenge(s, { language: c.language, difficulty, topic: '' }, `${why}\nThe previous statement, for reference:\n${String(c.statement).slice(0, 2000)}\nOpen the new statement with one line saying how it builds on "${c.title}".`);
      n.prevId = c.id; save(s); res.json(n);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- read aloud: Microsoft Edge neural voices (online, human-like), espeak through speech-dispatcher when offline ----------
  // ponytail: msedge-tts uses Edge's unofficial read-aloud endpoint; if Microsoft changes it, the espeak fallback keeps working
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const VOICES = { ar: 'ar-SA-ZariyahNeural', en: 'en-US-AvaMultilingualNeural' };
  const spdEnv = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}` };
  const hasSpd = ['/usr/bin/spd-say', '/usr/local/bin/spd-say'].some(f => fs.existsSync(f));
  async function neural(text, lang) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(VOICES[lang], OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text), chunks = [];
      const timer = setTimeout(() => audioStream.destroy(new Error('voice service timed out')), 15000);
      try { for await (const c of audioStream) chunks.push(c); } finally { clearTimeout(timer); }
      if (!chunks.length) throw new Error('voice service returned no audio');
      return Buffer.concat(chunks);
    } finally { try { tts.close(); } catch {} }
  }
  app.get('/api/speak', (req, res) => res.json({ available: true }));
  app.post('/api/speak', async (req, res) => {
    execFile('spd-say', ['-C'], { env: spdEnv }, () => {});
    const text = String(req.body?.text || '').slice(0, 4000), lang = /arab/i.test(req.body?.lang || '') || /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
    if (!text || req.body?.stop) return res.json({ ok: true });
    try {
      const t0 = Date.now(), mp3 = await neural(text, lang); console.log(`[speak] ${lang} ${text.length} chars in ${Date.now() - t0}ms`);
      res.type('audio/mpeg').send(mp3);
    } catch (e) {
      console.warn('[speak] neural voice failed, using espeak:', e.message);
      if (!hasSpd) return res.status(502).json({ error: `Read-aloud is unavailable: ${e.message}` });
      execFile('spd-say', ['-o', 'espeak-ng', '-l', lang, '-r', '-15', text], { env: spdEnv }, () => {});
      res.json({ ok: true, fallback: 'espeak' });
    }
  });

  // ---------- offline reminder: an hourly cron entry runs remind.js, which notifies at most once a day ----------
  const TAG = '# cram-reminder';
  const crontab = () => new Promise(r => execFile('crontab', ['-l'], (e, out) => r(e ? '' : out)));
  app.get('/api/reminder', async (req, res) => {
    const line = (await crontab()).split('\n').find(l => l.includes(TAG));
    res.json({ enabled: !!line, hour: line ? +(line.match(/--hour (\d+)/)?.[1] ?? 19) : 19, supported: process.platform === 'linux' });
  });
  app.post('/api/reminder', async (req, res) => {
    if (process.platform !== 'linux') return res.status(400).json({ error: 'Reminders while Cram is closed use cron, so they are Linux-only for now.' });
    const h = Math.round(+req.body?.hour), hour = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 19, keep = (await crontab()).split('\n').filter(l => l.trim() && !l.includes(TAG));
    const q = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
    if (req.body?.enabled) keep.push(`0 * * * * DBUS_SESSION_BUS_ADDRESS=${q(`unix:path=/run/user/${process.getuid()}/bus`)} ELECTRON_RUN_AS_NODE=1 ${q(process.execPath)} ${q(path.join(__dirname, 'remind.js'))} ${q(DATA)} --hour ${hour} ${TAG}`);
    const p = execFile('crontab', ['-'], e => e ? res.status(500).json({ error: `crontab failed: ${e.message}` }) : res.json({ enabled: !!req.body?.enabled, hour }));
    p.stdin.end(keep.join('\n') + '\n');
  });
};
module.exports.schedule = schedule;
module.exports.STEPS = STEPS;
