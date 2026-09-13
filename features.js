// Study features mounted on top of server.js: review queue (spaced repetition over missed quiz and
// interview answers, plus generated flashcards), per-study goals, weekly report, plan board, export
// to Notes, adaptive next coding challenge, offline daily reminder. server.js passes its helpers in.
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { execFile, spawn } = require('child_process');
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
      for (const iv of (s.interviews || []).filter(i => i.mode !== 'real')) (iv.turns || []).forEach((t, i) => {
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
    const now = Date.now(), note = { id: `export-${now.toString(36)}`, title: `${s.title} · practice log`, content: marked.parse([`*Exported from Cram on ${day(now)}.*`, ...md].filter(Boolean).join('\n\n')), parent: '', studyId: s.id, createdAt: now, updatedAt: now };
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
  const VOICES = { ar: 'ar-EG-SalmaNeural', en: 'en-US-AvaMultilingualNeural' };
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
  // Gemini TTS when a key is set in Settings: far more human, and it takes direction (an Egyptian interviewer's accent and pace)
  const GEMINI_TTS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']; // newest first; a 404 moves on
  const heard = new Map(); // lang:text → wav, so replaying a question does not spend quota again
  const wav = (pcm, rate) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };
  async function gemini(text, lang, key) {
    const style = lang === 'ar'
      ? 'Say this like a friendly, relaxed Egyptian job interviewer talking face to face, with a natural Cairo Egyptian accent (not formal Arabic), at a calm conversational pace, keeping English technical words in English'
      : 'Say this like a friendly, relaxed job interviewer talking face to face, at a calm conversational pace';
    let last;
    for (const model of GEMINI_TTS) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ contents: [{ parts: [{ text: `${style}:\n${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achird' } } } } }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) { last = new Error(`${model} is not available`); continue; }
      if (!r.ok) throw new Error(j.error?.message || `Gemini TTS answered ${r.status}`);
      const audio = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
      if (!audio) throw new Error('Gemini returned no audio');
      return wav(Buffer.from(audio.data, 'base64'), +(/rate=(\d+)/.exec(audio.mimeType || '')?.[1]) || 24000); // raw 16-bit PCM
    }
    throw last;
  }
  // ElevenLabs when a key and a voice are chosen in Settings: the most human voices; Egyptian ones come from its voice library
  const EL = 'https://api.elevenlabs.io/v1', SETTINGS_FILE = file('settings.json'), cfg = () => readJson(SETTINGS_FILE, {});
  const el = async (url, key, opts = {}) => {
    const r = await fetch(EL + url, { ...opts, headers: { 'xi-api-key': key, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(40000) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail?.message || (typeof j.detail === 'string' ? j.detail : '') || `ElevenLabs answered ${r.status}`); }
    return r;
  };
  const remember = (k, v) => { heard.delete(k); heard.set(k, v); if (heard.size > 40) heard.delete(heard.keys().next().value); };
  // voices to pick from: your own account's voices, then library voices (Egyptian Arabic first for Arabic)
  app.get('/api/eleven/voices', async (req, res) => {
    const s = cfg(), lang = req.query.lang === 'en' ? 'en' : 'ar';
    if (!s.elevenKey) return res.status(400).json({ error: 'Add your ElevenLabs API key first.' });
    try {
      const mine = (await (await el('/voices', s.elevenKey)).json()).voices || [];
      const tier = (await (await el('/user/subscription', s.elevenKey)).json()).tier || 'free'; // free plans may not speak with library voices over the API
      const shared = async q => (await (await el(`/shared-voices?page_size=60&${q}`, s.elevenKey)).json()).voices || [];
      let lib = lang === 'ar' ? await shared('language=ar&accent=egyptian') : await shared('language=en&use_cases=conversational');
      if (lang === 'ar' && !lib.length) lib = [...await shared('search=egyptian'), ...await shared('language=ar')];
      const voices = [
        ...mine.filter(v => !(tier === 'free' && v.category === 'professional')).map(v => ({ id: v.voice_id, name: v.name, accent: v.labels?.accent || '', gender: v.labels?.gender || '', age: v.labels?.age || '', about: v.labels?.description || '', preview: v.preview_url, mine: true })),
        ...lib.map(v => ({ id: v.voice_id, owner: v.public_owner_id, name: v.name, accent: v.accent || '', gender: v.gender || '', age: v.age || '', about: v.descriptive || String(v.description || '').slice(0, 120), preview: v.preview_url, locked: tier === 'free' })),
      ].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
      res.json({ selected: s.elevenVoices?.[lang]?.id || null, tier, voices });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  // choose a voice for a language; a library voice is added to your ElevenLabs account first (the API speaks only with those)
  app.post('/api/eleven/voice', async (req, res) => {
    const s = cfg(), { id, owner, name } = req.body || {}, lang = req.body?.lang === 'en' ? 'en' : 'ar';
    if (!s.elevenKey) return res.status(400).json({ error: 'Add your ElevenLabs API key first.' });
    try {
      let voiceId = String(id);
      if (owner) {
        const mine = (await (await el('/voices', s.elevenKey)).json()).voices || [];
        if (!mine.some(v => v.voice_id === voiceId)) voiceId = (await (await el(`/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(voiceId)}`, s.elevenKey, { method: 'POST', body: JSON.stringify({ new_name: String(name || 'Cram interviewer').slice(0, 60) }) })).json()).voice_id || voiceId;
      }
      const s2 = cfg(); s2.elevenVoices = { ...(s2.elevenVoices || {}), [lang]: { id: voiceId, name: String(name || '').slice(0, 60) } };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s2)); res.json({ ok: true, selected: voiceId });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  const model = s => s.elevenModel || 'eleven_multilingual_v2';
  // hear any usable voice say a line of Egyptian interview talk before choosing it (cached, so a second listen is free)
  const TRY = { ar: 'أهلاً، اتفضل استريح. بص يا سيدي، احكيلي كده عن آخر مشروع اشتغلت عليه... إيه أصعب حاجة قابلتك فيه؟', en: "Hey, thanks for coming in. So, tell me a bit about the last project you worked on... what was the hardest part?" };
  app.post('/api/eleven/try', async (req, res) => {
    const s = cfg(), lang = req.body?.lang === 'en' ? 'en' : 'ar', id = String(req.body?.id || '');
    if (!s.elevenKey || !id) return res.status(400).json({ error: 'Add your ElevenLabs API key first.' });
    const k = `try:${model(s)}:${id}:${lang}`;
    try { const hit = heard.get(k) || await eleven(TRY[lang], lang, { ...s, elevenVoices: { [lang]: { id } } }); remember(k, hit); res.type('audio/mpeg').send(hit); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });
  async function eleven(text, lang, s) {
    const keys = [s.elevenKey, s.elevenKey2].filter(Boolean);
    for (let i = 0; ; i++) {
      try { return await eleven1(text, lang, s, keys[i]); }
      catch (e) { if (i + 1 >= keys.length || !/quota|credits|character|invalid api key|unauthorized|limit/i.test(e.message)) throw e; console.warn('[speak] elevenlabs key', i + 1, 'failed, using the backup key:', e.message); }
    }
  }
  async function eleven1(text, lang, s, key) {
    const r = await el(`/text-to-speech/${encodeURIComponent(s.elevenVoices[lang].id)}?output_format=mp3_44100_128`, key, { method: 'POST', body: JSON.stringify({
      text, model_id: model(s),
      // conversational, not a newsreader: v3 takes only 0 / 0.5 / 1 (0.5 = "Natural"); v2 gets more style and less stability for livelier delivery
      voice_settings: model(s) === 'eleven_v3' ? { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true } : { stability: 0.3, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
    }) });
    return Buffer.from(await r.arrayBuffer());
  }
  app.get('/api/speak', (req, res) => res.json({ available: true }));
  app.post('/api/speak', async (req, res) => {
    execFile('spd-say', ['-C'], { env: spdEnv }, () => {});
    const text = String(req.body?.text || '').slice(0, 4000), lang = /arab/i.test(req.body?.lang || '') || /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
    if (!text || req.body?.stop) return res.json({ ok: true });
    const conf = cfg();
    if (conf.elevenKey && conf.elevenVoices?.[lang]) {
      try {
        const t0 = Date.now(), k = `el:${conf.elevenModel}:${conf.elevenVoices[lang].id}:${text}`, hit = heard.get(k) || await eleven(text, lang, conf);
        remember(k, hit); console.log(`[speak] elevenlabs ${lang} ${text.length} chars in ${Date.now() - t0}ms`);
        return res.type('audio/mpeg').send(hit);
      } catch (e) { console.warn('[speak] elevenlabs failed, trying the next voice:', e.message); }
    }
    const key = conf.geminiKey;
    if (key) {
      try {
        const t0 = Date.now(), k = `${lang}:${text}`, hit = heard.get(k) || await gemini(text, lang, key);
        heard.delete(k); heard.set(k, hit); if (heard.size > 40) heard.delete(heard.keys().next().value);
        console.log(`[speak] gemini ${lang} ${text.length} chars in ${Date.now() - t0}ms`);
        return res.type('audio/wav').send(hit);
      } catch (e) { console.warn('[speak] gemini voice failed, using Edge:', e.message); }
    }
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

  // ---------- speech to text for spoken answers: a warm local faster-whisper worker (stt.py) ----------
  // ponytail: one worker, requests answered in order; the venv lives outside the app (~/.local/share/cram-stt)
  const STT = path.join(os.homedir(), '.local/share/cram-stt/venv');
  const STT_PY = process.env.CRAM_STT_PY || path.join(STT, 'bin/python');
  let stt = null;
  function worker() {
    if (stt) return stt;
    // pip's CUDA libraries (cuBLAS, cuDNN) sit inside the venv; the loader only reads LD_LIBRARY_PATH at start
    const nv = (() => { try { const sp = fs.readdirSync(path.join(STT, 'lib')).map(v => path.join(STT, 'lib', v, 'site-packages/nvidia')).find(fs.existsSync); return sp ? fs.readdirSync(sp).map(d => path.join(sp, d, 'lib')).filter(fs.existsSync) : []; } catch { return []; } })();
    const p = spawn(STT_PY, [path.join(__dirname, 'stt.py')], { env: { ...process.env, LD_LIBRARY_PATH: [...nv, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }, stdio: ['pipe', 'pipe', 'pipe'] });
    const waiting = new Map(); let buf = '', n = 0;
    const me = stt = { ready: false, device: null, error: null, ask: (file, lang) => new Promise(r => { const id = ++n; waiting.set(id, r); p.stdin.write(JSON.stringify({ id, file, lang }) + '\n'); }) };
    p.stdout.on('data', d => {
      buf += d; const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) { let m; try { m = JSON.parse(l); } catch { continue; } if (m.ready) { me.ready = true; me.device = m.device; console.log(`[stt] ready on ${m.device}`); } else { waiting.get(m.id)?.(m); waiting.delete(m.id); } }
    });
    let err = ''; p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    const fail = msg => { me.error = msg; for (const r of waiting.values()) r({ error: msg }); waiting.clear(); if (stt === me) stt = null; };
    p.on('error', e => fail(e.message));
    p.on('exit', code => { console.warn('[stt] worker exited', code, err.slice(-400)); fail(`Speech recognition stopped${err ? `: ${err.trim().split('\n').pop()}` : ''}`); });
    return me;
  }
  // GET also warms the worker up, so the model is loaded before the first answer
  app.get('/api/transcribe', (req, res) => { const available = fs.existsSync(STT_PY); const w = available && worker(); res.json({ available, ready: !!w?.ready, device: w?.device || null }); });
  app.post('/api/transcribe', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
    if (!fs.existsSync(STT_PY)) return res.status(501).json({ error: 'Speech recognition is not installed on this computer.' });
    if (!req.body?.length) return res.status(400).json({ error: 'no audio' });
    const f = path.join(os.tmpdir(), `cram-answer-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(f, req.body);
    try { const t0 = Date.now(), r = await worker().ask(f, req.query.lang === 'ar' ? 'ar' : 'en'); if (r.error) return res.status(500).json({ error: r.error }); console.log(`[stt] ${req.query.lang} ${req.body.length >> 10}KB in ${Date.now() - t0}ms`); res.json({ text: r.text }); }
    finally { fs.rmSync(f, { force: true }); }
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
