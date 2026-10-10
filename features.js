// Study features mounted on top of server.js: review queue (spaced repetition over missed quiz and
// interview answers, plus generated flashcards), per-study goals, weekly report, plan board, export
// to Notes, adaptive next coding challenge, offline daily reminder. server.js passes its helpers in.
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { execFile, spawn } = require('child_process');
const { marked } = require('marked');
const roles = require('./roles');

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
// the reverse, for model text: a prompt once went through esc, so the model wrote "List&lt;T&gt;" back and it was saved that way
const unent = t => String(t ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const unentOutline = o => o?.items ? { ...o, items: o.items.map(i => ({ ...i, title: unent(i.title), ...(i.desc ? { desc: unent(i.desc) } : {}) })) } : o;

module.exports = (app, ctx) => {
  const { study, save, touch, json, DATA, NO_STUDY, readJson, localDay, events, loadNotes, saveNotes, makeChallenge, profileDir, studiesDir, profileFile, coachFile } = ctx;
  // resolved per call, never captured: switching profile re-points them without remounting anything
  const file = n => path.join(profileDir(), n);
  const write = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v));
  const allStudies = () => fs.readdirSync(studiesDir()).map(id => { try { return study(id); } catch { return null; } }).filter(Boolean);
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
    const p = readJson(profileFile(), {}), r = loadReview(), now = Date.now();
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
    const start = new Date(`${k}T00:00`).getTime(), last = weekStats(start - 7 * DAY, start), prev = weekStats(start - 14 * DAY, start - 7 * DAY), p = readJson(profileFile(), {});
    const prompt = `Write the weekly study report for ${p.name ? p.name.split(' ')[0] : 'the learner'} for the week ending ${localDay(start - DAY)}. Their goal: ${p.goal || 'not given'}. Target: ${p.hoursPerWeek || 5} hours/week.
Last week: ${last.minutes} min, ${last.sessions} sessions, average score ${last.avg ?? 'n/a'}%. Per study: ${last.perStudy}.
${last.list.join('\n') || '- no sessions'}
The week before: ${prev.minutes} min, ${prev.sessions} sessions, average score ${prev.avg ?? 'n/a'}%. Per study: ${prev.perStudy}.
${app.locals.coachContext()}
${roles.roleContext(p)} ${roles.addressRule(p)}
The tools that exist are: ${roles.toolSentence(p)}. There is no quiz tool; never suggest a quiz. Compare the two weeks honestly and use the numbers. If last week had no study, say so plainly and make the focus a small restart. Address them by first name. Never mention ids. Respond with ONLY JSON: {"summary": string (2 sentences), "improved": [0-3 strings], "slipped": [0-3 strings], "focus": string (one concrete focus for this week)}`;
    try {
      const r = await json(NO_STUDY, prompt);
      all[k] = { ...r, stats: { minutes: last.minutes, sessions: last.sessions, avg: last.avg, prevMinutes: prev.minutes, prevSessions: prev.sessions, prevAvg: prev.avg }, at: Date.now() };
      write('reports.json', all); res.json({ week: k, report: all[k] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- plan board: to-dos placed on days ----------
  const TOOLS = ['ask', 'quiz', 'interview', 'code', 'review', 'notes'];
  app.get('/api/plan', (req, res) => res.json({ items: readJson(file('plan.json'), []), coach: readJson(coachFile(), null)?.plan?.todos || [] }));
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

  // ---------- blog: long articles about what you study, each with a threaded discussion under it ----------
  // Two calls per article: the body, then the comments written against that finished body, so the thread
  // actually answers the article (and neither call runs near the CLI's timeout). Saved one at a time.
  const BLOG = 'blog.json';
  // picked per run in the Generate dialog; anything else falls back to the subject's own language
  const LANGS = { english: 'Write it in English.', arabic: 'Write it in Egyptian Arabic, keeping technical terms in English.' };
  const loadBlog = () => readJson(file(BLOG), []);
  const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const card = a => ({ id: a.id, title: a.title, studyId: a.studyId, studyTitle: a.studyTitle, at: a.at, minutes: a.minutes,
    comments: a.comments?.length || 0, excerpt: strip(a.body).slice(0, 220),
    search: `${a.title} ${strip(a.body)} ${(a.comments || []).map(c => `${c.author} ${c.text}`).join(' ')}`.toLowerCase().slice(0, 8000) });
  app.get('/api/blog', (req, res) => res.json({ articles: loadBlog().map(card) }));
  app.get('/api/blog/:aid', (req, res) => { const a = loadBlog().find(x => x.id === req.params.aid); a ? res.json(a) : res.status(404).json({ error: 'no such article' }); });
  app.delete('/api/blog/:aid', (req, res) => { write(BLOG, loadBlog().filter(x => x.id !== req.params.aid)); res.json({ ok: true }); });

  // one article: body, then its discussion. Returns the saved article; throws so the caller can report it.
  // emit: what the generate panel sees ({stage}, then throttled {progress} while the model writes)
  async function writeArticle(s, avoid = [], signal, emit = () => {}, lang = '') {
    // the model's raw JSON as it streams: a rough count plus its last line, enough to watch it move
    const live = count => { let text = '', last = 0; return d => {
      text += d; if (Date.now() - last < 400) return; last = Date.now();
      emit({ progress: { [count]: count === 'words' ? text.split(/\s+/).length : (text.match(/"author"\s*:/g) || []).length,
        tail: text.slice(-180).replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim() } });
    }; };
    const level = { beginner: 'a beginner', mid: 'someone past the basics', expert: 'an experienced practitioner' }[s.level];
    const me = readJson(profileFile(), {});
    const who = `${roles.roleContext(me)} ${roles.addressRule(me)}`.trim(); // so a nutritionist's article is not written for engineers, and it addresses her correctly
    const b = await json(s, `Write a deep, practical article for someone studying "${esc(s.title)}"${s.subject ? ` (${esc(s.subject)})` : ''}.${level ? ` The reader is ${level}.` : ''}
It must be a 10 minute read at minimum: 1800-2400 words. Teach one specific, worthwhile idea from this subject in depth — not an overview of everything. ${who} Use concrete examples and a worked scenario from that practice, and short code or diagrams only where they genuinely earn their place. Markdown, with ## sections. No preamble about what the article will cover.
${LANGS[lang] || 'Write it in the language of the subject.'}${avoid.length ? ` Do NOT write about these, they are already covered: ${avoid.map(t => `"${esc(t)}"`).join('; ')}.` : ''}
Respond with ONLY JSON: {"title": string, "minutes": number (the honest reading time), "body": markdown string}`, undefined, { signal, onDelta: live('words') });
    if (!b?.body) throw new Error('no article came back');
    const body = String(b.body);
    emit({ stage: 'comments', words: body.split(/\s+/).length }); // the panel's second stage: the thread is written against the finished body
    const c = await json(s, `Below is an article titled "${esc(b.title)}". Write the comment thread under it, as if on a forum read by experienced practitioners in this field. ${who}
At least 20 comments from named people with different backgrounds and opinions. They must be a real conversation: some ask sharp questions about the article, others answer them, people disagree with each other, correct a detail, add a war story from production, or take a point further. A reply must clearly answer the comment it replies to.
Set "replyTo" to the 0-based index of the comment being replied to, or null for a top-level comment. Replies may nest. Write in the same language as the article.
Respond with ONLY JSON: {"comments": [{"author": string, "role": short string like "payments team, 8y", "text": string, "replyTo": number or null}]}

Article:
${body.slice(0, 12000)}`, undefined, { signal, onDelta: live('comments') }).catch(() => null); // the article is worth keeping even if the thread fails
    const comments = (c?.comments || []).slice(0, 60).map((x, i) => ({
      author: String(x.author || 'Anonymous').slice(0, 60), role: String(x.role || '').slice(0, 80), text: String(x.text || '').slice(0, 4000),
      replyTo: Number.isInteger(+x.replyTo) && +x.replyTo >= 0 && +x.replyTo < i ? +x.replyTo : null, // only backwards: no cycles
    })).filter(x => x.text);
    const now = Date.now();
    const a = { id: `art-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, studyId: s.id, studyTitle: s.title, at: now,
      title: String(b.title || s.title).slice(0, 200), minutes: Math.max(10, Math.round(+b.minutes) || 10), body: marked.parse(body), comments };
    write(BLOG, [a, ...loadBlog()]);
    return a;
  }

  // streamed like the Q&A note: {stage} per phase, {saved} per finished article, then {error} if one fails
  // One article per request, and the page asks again for the next one. A server-side loop could not be
  // stopped honestly: the client's abort needs a round trip, by which time the next (expensive) article
  // has already started. Asking again also means `avoid` re-reads what is on disk, including the last one.
  app.post('/api/blog/generate', async (req, res) => {
    const s = findStudy({ params: { id: String(req.body?.studyId || '') } }, res); if (!s) return;
    res.setHeader('Content-Type', 'application/x-ndjson');
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const send = m => { if (!ac.signal.aborted) res.write(JSON.stringify(m) + '\n'); };
    const avoid = loadBlog().filter(a => a.studyId === s.id).slice(0, 12).map(a => a.title);
    const lang = LANGS[req.body?.language] ? String(req.body.language) : ''; // allowlisted: only what we have a sentence for
    try { send({ stage: 'body' }); const a = await writeArticle(s, avoid, ac.signal, send, lang); send({ saved: card(a) }); }
    catch (e) { if (!ac.signal.aborted) send({ error: e.message }); }
    res.end();
  });

  // ---------- two articles a day, while Cram is open (Settings → Daily articles) ----------
  // The quota is counted off disk rather than kept as a counter, so a restart, a crash or an article
  // you wrote by hand can never make it spend twice. Studies take turns, newest first.
  const DAILY = 2;
  const madeToday = () => { const today = localDay(Date.now()); return loadBlog().filter(a => localDay(a.at) === today).length; };
  let dailyRunning = false;
  async function dailyTick() {
    if (dailyRunning || !readJson(path.join(DATA, 'settings.json'), {}).blogDaily) return; // settings are machine-level, not per profile
    const missing = DAILY - madeToday(); if (missing <= 0) return;
    const list = allStudies().filter(s => !s.general).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!list.length) return;
    dailyRunning = true;
    try {
      for (let i = 0; i < missing; i++) {
        const s = list[i % list.length];
        const avoid = loadBlog().filter(a => a.studyId === s.id).slice(0, 12).map(a => a.title);
        try { await writeArticle(s, avoid); } catch (e) { console.log(`         [blog] daily article failed: ${e.message}`); break; }
      }
    } finally { dailyRunning = false; }
  }
  module.exports.dailyTick = dailyTick; // the test drives it directly
  if (!process.env.CRAM_NO_CRON) { setTimeout(dailyTick, 60000).unref(); setInterval(dailyTick, 36e5).unref(); } // a minute after launch, then hourly

  // ---------- a subject study's chapter plan: empty chapters (titles only), so you can see what you are going to study.
  // server.js owns /outline for PDF studies and passes everything else here. Planned once, on first view, then cached. ----------
  app.get('/api/studies/:id/outline', async (req, res) => {
    let s; try { s = study(path.basename(req.params.id)); } catch { return res.status(404).json({ error: 'no such study' }); }
    if (s.outline && !req.query.refresh) return res.json(unentOutline(s.outline)); // cached: plain JSON, whatever was asked for
    const level = { beginner: 'a complete beginner', mid: 'at an intermediate level, past the basics', expert: 'an advanced learner who wants depth and edge cases' }[s.level];
    // Planning takes 15-130s. With ?stream=1 the panel watches it happen — chapters counted and the tail
    // shown as they are written — instead of one motionless sentence. Without it the route is plain JSON.
    const streaming = req.query.stream === '1';
    let emit = () => {}, ac = null;
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
      emit = m => { if (!ac.signal.aborted) res.write(JSON.stringify(m) + '\n'); };
    }
    // counted off the raw JSON as it arrives: "depth": 0 is a chapter, every "title" is a line of the plan
    const live = (() => { let text = '', last = 0; return d => {
      text += d; const now = Date.now(); if (now - last < 400) return; last = now;
      emit({ progress: { chapters: (text.match(/"depth"\s*:\s*0/g) || []).length, titles: (text.match(/"title"\s*:/g) || []).length, tail: text.slice(-140).replace(/\s+/g, ' ') } });
    }; })();
    try {
      emit({ stage: 'planning' });
      // A pasted syllabus (several lines, or a long paragraph from the older one-line box) is the learner's own plan:
      // the chapters follow it in its order instead of being invented. A one-line subject is still planned freely.
      const own = !!s.subject && (s.subject.split('\n').filter(l => l.trim()).length >= 4 || s.subject.length > 300);
      // plain text into the prompt, never esc(): the model copies whatever it reads, entities included
      const r = await json(s, own ? `The learner wrote their own study outline for "${s.title}". Turn it into chapters that follow it exactly.
<outline>
${s.subject.replace(/<\/outline>/gi, '')}
</outline>
Rules: keep their order, from the first line to the last. Their headings (phases, weeks, parts, big topics) become chapters, and the items listed under a heading become that chapter's sections. Use their own wording for titles. Never reorder, never drop a listed topic, never add topics they did not list. A heading with many items may be split into consecutive chapters with a clear suffix (e.g. "C# core: types and memory", then "C# core: language features"), still in their order. Lines that are advice rather than topics ("don't waste time on syntax", "understand the mechanics", "this deserves serious attention") are not chapters or sections: put them, shortened, in that chapter's "desc". Write in the language of the outline. ${level ? `The learner is ${level}.` : ''}
Respond with ONLY JSON: {"items": [{"title": string, "depth": 0 for a chapter, 1 for a section, "desc": string (optional, chapters only: their advice for it, one line)}]}` : `Plan what to study for "${s.title}"${s.subject ? `, specifically: ${s.subject}` : ''}. ${level ? `The learner is ${level}, so start where that level starts and pitch the depth for them.` : ''}
Give 6 to 12 chapters in the order they should be studied, each with 2 to 5 sections inside it. Titles only, no descriptions: this is a plan of what is coming, not the material itself. Write the titles in the language of the subject.
Respond with ONLY JSON: {"items": [{"title": string, "depth": 0 for a chapter, 1 for a section}]}`, undefined, streaming ? { signal: ac.signal, onDelta: live } : undefined);
      const items = (r.items || []).filter(x => x.title).slice(0, own ? 250 : 80)
        .map(x => ({ title: unent(x.title).slice(0, 200), depth: Math.min(1, Math.max(0, Math.round(+x.depth) || 0)), ...(x.desc && !x.depth ? { desc: unent(x.desc).slice(0, 300) } : {}) }));
      if (!items.length) throw new Error('No chapters came back. Try again.');
      const s2 = study(s.id); s2.outline = { at: Date.now(), from: own ? 'outline' : 'subject', items }; save(s2);
      if (streaming) { emit({ result: s2.outline }); res.end(); } else res.json(s2.outline);
    } catch (e) {
      if (streaming) { emit({ error: e.message }); res.end(); } else res.status(500).json({ error: e.message });
    }
  });

  // ---------- interview Q&A note: picked questions with their right answers, grouped by topic. One note per interview,
  // grown on each export; turns written into it carry inNote so the picker can default to the rest ----------
  app.post('/api/studies/:id/interviews/:iid/qa-note', async (req, res) => {
    const s = findStudy(req, res); if (!s) return;
    const iv = (s.interviews || []).find(x => x.id === req.params.iid); if (!iv) return res.status(404).json({ error: 'no such interview' });
    const picked = [...new Set((Array.isArray(req.body?.turns) ? req.body.turns : []).map(Number))].filter(i => iv.turns[i]).sort((a, b) => a - b);
    if (!picked.length) return res.status(400).json({ error: 'Pick at least one question.' });
    // streamed as lines of JSON so the picker can tick questions off: {done: i} | {failed: i} per question,
    // {saved: [i], iv, note} each time questions land in the note, then {result} or {error}
    res.setHeader('Content-Type', 'application/x-ndjson');
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); }); // Cancel / closed dialog: stop asking
    const send = m => { if (!ac.signal.aborted) res.write(JSON.stringify(m) + '\n'); };
    // Saved as it goes, so a cancel or a closed app keeps what was written. Sorted by topic, and a question is appended
    // only once every question before it has an answer or failed: the note stays grouped and is only ever appended to.
    picked.sort((a, b) => String(iv.turns[a].topic || '').localeCompare(String(iv.turns[b].topic || '')) || a - b);
    const answers = new Map(), failed = new Set(); let next = 0, flushed = 0, lastTopic = null, note = null, lastIv = null;
    // An Arabic interview's note opens right-aligned and RTL: the Notes editor reads dir and text-align off these blocks
    // (lines inside a list follow the list). Code blocks are left alone, code reads left to right.
    const layout = h => /arab/i.test(iv.language) ? h.replace(/<(p|h[1-6]|ul|ol|blockquote)(\s[^>]*)?>/g, '<$1 dir="rtl" style="text-align: right"$2>') : h;
    const flush = () => {
      let md = ''; const ids = [];
      while (flushed < picked.length && (answers.has(picked[flushed]) || failed.has(picked[flushed]))) {
        const i = picked[flushed++], x = answers.get(i); if (!x) continue;
        const k = String(iv.turns[i].topic || x.topic || 'General');
        md += `${k !== lastTopic ? `## ${esc(k)}\n\n` : ''}### ${esc(iv.turns[i].q)}\n\n${x.answer}\n\n`; lastTopic = k; ids.push(i);
      }
      if (!ids.length) return;
      const html = layout(marked.parse(md));
      // the study may have changed during the calls (an answer graded): write into a fresh copy
      const s2 = study(req.params.id), iv2 = (s2.interviews || []).find(x => x.id === iv.id); if (!iv2) throw new Error('This interview was deleted.');
      const notes = loadNotes(), now = Date.now(); note = iv2.qaNote && notes.find(n => n.id === iv2.qaNote);
      if (note) { note.content += html; note.updatedAt = now; }
      else { // first export, or the old note was deleted
        iv2.turns.forEach(t => delete t.inNote);
        const name = iv2.mode === 'real' ? `${iv2.role} · ${iv2.round}` : `${s2.title} · ${iv2.difficulty}`;
        note = { id: `qa-${now.toString(36)}`, title: `${name} interview · Q&A`, content: layout(marked.parse(`*Questions and right answers from a Cram interview on ${new Date(iv2.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.*`)) + html, parent: '', ...(s2.general ? {} : { studyId: s2.id }), createdAt: now, updatedAt: now };
        notes.unshift(note); iv2.qaNote = note.id;
      }
      saveNotes(null, notes);
      ids.forEach(i => { if (iv2.turns[i]) iv2.turns[i].inNote = true; });
      save(s2); lastIv = iv2; send({ saved: ids, iv: iv2, note: { id: note.id, title: note.title } });
    };
    await Promise.all(Array.from({ length: Math.min(4, picked.length) }, async () => { // ponytail: 4 answers at a time, raise if the CLI copes
      while (next < picked.length && !ac.signal.aborted) {
        const i = picked[next++], t = iv.turns[i];
        try {
          const r = await json(s, `Write a study note: the correct answer to this interview question that the learner should remember. ${/arab/i.test(iv.language) ? 'Write in Egyptian Arabic, keeping technical terms in English.' : 'Write in English.'}
Never mention, quote or grade the learner's own answer. Teach it as a model interview conversation the learner can study and replay, in this markdown layout (translate the labels when not writing English):
1. A bold line "Correct answer:" with the direct answer in one or two sentences.
2. A bold line "The conversation:" then a realistic exchange of 4-8 turns, each turn its own paragraph starting "**🎤 Interviewer:**" or "**✅ Strong candidate:**". The candidate gives the right answer the way a senior would say it out loud; the interviewer pushes back with the follow-ups a real interviewer asks next (why, what if it fails, trade-offs, scale, an edge case), and the candidate answers each one.
3. After any candidate turn with an idea worth learning, a blockquote line "> 💡 **Why:** ..." explaining the reasoning behind it in plain words.
4. A bold line "Remember:" then 3-5 short bullets: the key points, plus the common mistake that loses marks on this question.
Add a small example or code snippet inside a candidate turn only when it really helps. No heading and do not repeat the question.
Question${t.topic ? ` [${t.topic}]` : ''}: ${t.q}
Respond with ONLY JSON: {"topic": short topic label, "answer": markdown string}`, undefined, { signal: ac.signal });
          if (!r.answer) throw new Error('no answer came back');
          answers.set(i, r); send({ done: i });
        } catch (e) { failed.add(i); send({ failed: i, error: e.message }); }
        try { flush(); } catch (e) { send({ error: e.message }); ac.abort(); }
      }
    }));
    if (ac.signal.aborted) return res.end(); // cancelled: what finished is already in the note
    if (!answers.size) send({ error: 'No answers came back. Try again.' });
    else if (note) send({ result: { iv: lastIv, note: { id: note.id, title: note.title }, failed: failed.size } });
    res.end();
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

  // ---------- job prep: match a CV to a job description, research the company's interviews, build a practice plan ----------
  const PREP = () => file('prep.json'), loadPrep = () => readJson(PREP(), []); // a function now: file() moves with the profile
  const { verify } = require('./linkcheck');
  const PREP_ROUNDS = ['technical', 'behavioral', 'situational', 'management', 'system-design', 'architecture'];
  app.get('/api/prep', (req, res) => res.json(loadPrep().map(({ cv, ...p }) => p)));
  app.delete('/api/prep/:pid', (req, res) => { fs.writeFileSync(PREP(), JSON.stringify(loadPrep().filter(p => p.id !== req.params.pid))); res.json({ ok: true }); });
  // a CV picked as a PDF becomes text with pdftotext (poppler)
  app.post('/api/prep/cv-text', (req, res) => {
    const f = String(req.body?.path || '');
    if (!/\.pdf$/i.test(f) || !fs.existsSync(f)) return res.status(400).json({ error: 'Pick a PDF file.' });
    execFile('pdftotext', ['-layout', f, '-'], { maxBuffer: 8e6, timeout: 30000 }, (e, out) => e ? res.status(500).json({ error: e.code === 'ENOENT' ? 'pdftotext is not installed (poppler-utils).' : e.message }) : res.json({ text: out.slice(0, 15000) }));
  });
  app.post('/api/prep', async (req, res) => {
    const b = req.body || {}, clip = (v, n) => String(v || '').trim().slice(0, n);
    const p = { id: Date.now().toString(36), at: Date.now(), role: clip(b.role, 80), seniority: clip(b.seniority, 20) || 'mid', company: clip(b.company, 80), language: /arab/i.test(b.language) ? 'Arabic' : 'English', jd: clip(b.jd, 8000), cv: clip(b.cv, 15000) };
    if (!p.jd && !p.cv) return res.status(400).json({ error: 'Paste a job description, your CV, or both.' });
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const g = study('_general'), lang = p.language === 'Arabic' ? 'Write every text field in Egyptian colloquial Arabic, keeping technical terms in English.' : 'Write every text field in English.';
    try {
      if (p.company) {
        const r = await json(g, `Use web search to research how ${p.company} interviews candidates for "${p.role || 'this kind of'}" roles: the stages of the process, what they are known to value, and questions candidates report being asked. Copy every URL exactly from a search result; never guess one. ${lang} Respond with ONLY JSON: {"process": [short strings, one per stage], "values": [short strings], "questions": [5-10 strings], "sources": [2-6 of {"title": string, "url": string}]}`, undefined, { web: true, signal: ac.signal });
        p.research = { process: (r.process || []).map(String).slice(0, 8), values: (r.values || []).map(String).slice(0, 8), questions: (r.questions || []).map(String).slice(0, 10),
          sources: (await verify((r.sources || []).map(x => ({ ...x, kind: 'article' })), {})).map(x => ({ title: x.title, url: x.url })) };
      }
      const r = await json(g, `You prepare a candidate for a job interview. ${lang}
Role: ${p.role || '(infer it from the job description)'}, ${p.seniority} level${p.company ? `, at ${p.company}` : ''}.
Job description:
<jd>
${p.jd || '(not given)'}
</jd>
Candidate CV:
<cv>
${p.cv || '(not given)'}
</cv>
${p.research ? `What is known about ${p.company}'s interviews: ${JSON.stringify({ process: p.research.process, values: p.research.values, questions: p.research.questions })}\n` : ''}Compare the CV with the job honestly. Then build a practice plan with the tools that exist: mock interview rounds (${PREP_ROUNDS.join(', ')}), coding challenges on a topic, and flashcards.
Respond with ONLY JSON: {"fit": {"score": number 0-100, "summary": string (2-3 sentences)}, "strengths": [2-5 strings], "gaps": [2-6 of {"skill": string, "why": string, "how": string (a concrete way to close it)}], "rounds": [2-4 of {"round": one of the round ids above, "focus": string}], "codingTopics": [0-4 short strings, only if the role writes code], "likelyQuestions": [5-8 strings], "flashcards": [6-10 of {"q": string, "a": string}]}`, undefined, { signal: ac.signal });
      p.plan = {
        fit: { score: Math.max(0, Math.min(100, Math.round(+r.fit?.score || 0))), summary: String(r.fit?.summary || '') },
        strengths: (r.strengths || []).map(String).slice(0, 5),
        gaps: (r.gaps || []).filter(x => x?.skill).map(x => ({ skill: String(x.skill), why: String(x.why || ''), how: String(x.how || '') })).slice(0, 6),
        rounds: (r.rounds || []).filter(x => PREP_ROUNDS.includes(x?.round)).map(x => ({ round: x.round, focus: String(x.focus || '') })).slice(0, 4),
        codingTopics: (r.codingTopics || []).map(String).slice(0, 4), likelyQuestions: (r.likelyQuestions || []).map(String).slice(0, 8),
        flashcards: (r.flashcards || []).filter(c => c?.q && c?.a).map(c => ({ q: String(c.q), a: String(c.a) })).slice(0, 12),
      };
      if (ac.signal.aborted) return;
      const list = loadPrep(); list.unshift(p); fs.writeFileSync(PREP(), JSON.stringify(list.slice(0, 30)));
      const { cv, ...out } = p; res.json(out);
    } catch (e) { if (!ac.signal.aborted) res.status(500).json({ error: e instanceof SyntaxError ? 'The reply came back garbled. Try again.' : e.message }); }
  });
  // the plan's flashcards join the review queue as General practice cards
  app.post('/api/prep/:pid/cards', (req, res) => {
    const list = loadPrep(), p = list.find(x => x.id === req.params.pid); if (!p?.plan) return res.status(404).json({ error: 'no such plan' });
    if (p.cardsAdded) return res.json({ added: 0, already: true });
    const now = Date.now(), rv = loadReview();
    const added = p.plan.flashcards.map((c, i) => ({ id: `prep-${p.id}-${i}`, key: `prep:${p.id}:${i}`, studyId: '_general', source: 'card', q: c.q, a: c.a, choices: null, answerIndex: null, step: -1, reps: 0, lapses: 0, createdAt: now, dueAt: now }));
    rv.cards.push(...added); write('review.json', rv); p.cardsAdded = now; fs.writeFileSync(PREP(), JSON.stringify(list)); res.json({ added: added.length });
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
  const EL = 'https://api.elevenlabs.io/v1', SETTINGS_FILE = path.join(DATA, 'settings.json'), cfg = () => readJson(SETTINGS_FILE, {}); // keys are machine-level, not per profile
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
  // characters used on each key this month
  app.get('/api/eleven/usage', async (req, res) => {
    const s = cfg(), keys = [['main', s.elevenKey], ['backup', s.elevenKey2]].filter(k => k[1]);
    res.json(await Promise.all(keys.map(async ([name, key]) => {
      try { const o = await (await el('/user/subscription', key)).json(); return { name, tier: o.tier, used: o.character_count, limit: o.character_limit, resetAt: (o.next_character_count_reset_unix || 0) * 1000 }; }
      catch (e) { return { name, error: e.message }; }
    })));
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
    const p = spawn(STT_PY, [path.join(__dirname, 'stt.py').replace('app.asar', 'app.asar.unpacked')], { env: { ...process.env, LD_LIBRARY_PATH: [...nv, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    try { const t0 = Date.now(), r = await worker().ask(f, { ar: 'ar', en: 'en' }[req.query.lang] || null); if (r.error) return res.status(500).json({ error: r.error }); console.log(`[stt] ${req.query.lang} ${req.body.length >> 10}KB in ${Date.now() - t0}ms`); res.json({ text: r.text }); }
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

  // ---------- roadmaps (career moves and skill mastery) ----------
  // Where I am → where I want to be, as a road of stages, each with sub-steps the learner ticks off.
  const ROADMAP = () => file('roadmap.json'), loadRoadmaps = () => readJson(ROADMAP(), []);
  const PATHS = { change: 'change careers into a different field', grow: 'grow deeper in their current career', lead: 'get promoted or move into leadership', switch: 'switch to a different specialization within their field', start: 'land their first job, starting from zero', freelance: 'go freelance or build their own business', return: 'come back to work after a break' };
  app.get('/api/roadmap', (req, res) => res.json(loadRoadmaps()));
  app.delete('/api/roadmap/:rid', (req, res) => { write('roadmap.json', loadRoadmaps().filter(r => r.id !== req.params.rid)); res.json({ ok: true }); });
  app.post('/api/roadmap/:rid', (req, res) => {
    const list = loadRoadmaps(), r = list.find(x => x.id === req.params.rid); if (!r) return res.status(404).json({ error: 'no such roadmap' });
    r.done = (Array.isArray(req.body?.done) ? req.body.done : []).map(String).slice(0, 200); write('roadmap.json', list); res.json({ ok: true });
  });
  // One study per roadmap: every step becomes a chapter, its detail shown under the title. The chapter list is
  // written here, so the study never plans its own (outline.from 'roadmap'). Asking again opens the same study.
  app.post('/api/roadmap/:rid/study', (req, res) => {
    const list = loadRoadmaps(), r = list.find(x => x.id === req.params.rid); if (!r?.plan) return res.status(404).json({ error: 'no such roadmap' });
    if (r.studyId && fs.existsSync(path.join(studiesDir(), r.studyId, 'study.json'))) return res.json({ id: r.studyId });
    const now = Date.now(), level = r.kind === 'skill' ? { none: 'beginner', beginner: 'beginner', intermediate: 'mid', advanced: 'expert' }[r.level] || '' : '';
    const subject = r.kind === 'skill' ? `Mastering ${r.skill}, from ${r.now.split('\n')[0].toLowerCase()} to ${r.target}` : `The road from "${r.now}" to "${r.target}"`;
    const s = { id: now.toString(36), title: r.plan.title, subject: subject.slice(0, 600), level, hasPdf: false, roadmapId: r.id, createdAt: now, updatedAt: now, chat: [], interviews: [], quizzes: [], challenges: [],
      outline: { at: now, from: 'roadmap', items: r.plan.stages.flatMap(st => st.steps.map(t => ({ title: t.title, desc: t.detail, depth: 0 }))) } };
    fs.mkdirSync(path.join(studiesDir(), s.id)); save(s);
    r.studyId = s.id; write('roadmap.json', list); res.json({ id: s.id });
  });
  // kind 'skill': one skill (DDD, system design…) from the learner's current level to expert, on the same road
  const SKILL_LEVELS = { none: 'Never touched it', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  app.post('/api/roadmap', async (req, res) => {
    const b = req.body || {}, clip = (v, n) => String(v || '').trim().slice(0, n), me = readJson(profileFile(), {}), skillKind = b.kind === 'skill';
    const r = { id: Date.now().toString(36), at: Date.now(), kind: skillKind ? 'skill' : 'career', path: PATHS[b.path] ? b.path : 'other', pathOther: clip(b.pathOther, 120), now: clip(b.now, 2000), target: clip(b.target, 2000),
      months: Math.max(1, Math.min(60, Math.round(+b.months) || 12)), hours: Math.max(1, Math.min(80, Math.round(+b.hours) || 8)), language: /arab/i.test(b.language) ? 'Arabic' : 'English', done: [] };
    if (skillKind) {
      r.skill = clip(b.skill, 120); r.level = SKILL_LEVELS[b.level] ? b.level : 'none'; delete r.path; delete r.pathOther;
      if (!r.skill) return res.status(400).json({ error: 'Name the skill you want to master.' });
      r.target = r.target || `Expert in ${r.skill}`; r.now = `${SKILL_LEVELS[r.level]} in ${r.skill}${r.now ? `\n${r.now}` : ''}`; // now/target keep the road's start and finish cards the same for both kinds
    }
    if (!r.now || !r.target) return res.status(400).json({ error: 'Say where you are now and where you want to be.' });
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const lang = r.language === 'Arabic' ? 'Write every text field in Egyptian colloquial Arabic, keeping technical terms and job titles in English.' : 'Write every text field in English.';
    const shape = `Respond with ONLY JSON: {"title": string (max 8 words), "summary": string (2-3 sentences), "reality": string (one honest line on how realistic the time frame is), "stages": [{"title": string (max 6 words),${skillKind ? ' "level": "Beginner"|"Intermediate"|"Advanced"|"Expert",' : ''} "goal": string (one line: what is true once this stage is done), "duration": string (e.g. "${skillKind ? 'Weeks 1-3' : 'Months 1-2'}"), "steps": [{"title": string (max 10 words), "detail": string (1-2 sentences: how, and what counts as done)}]}], "finish": string (one line describing them at the destination)}`;
    try {
      const x = await json(NO_STUDY, skillKind ? `You are a world-class practitioner and teacher of ${r.skill} who has taken many people from zero to expert. ${lang}
The learner wants to master: ${r.skill}. Their level today: ${SKILL_LEVELS[r.level]}.
${b.now ? `About them and why they want it:\n<context>\n${clip(b.now, 2000)}\n</context>\n` : ''}Where they want to end up: ${r.target}.
Time frame: about ${r.months} months, at ${r.hours} hours per week.
${roles.roleContext(me)} ${roles.addressRule(me)}
Build a mastery roadmap as a road: 4-7 stages in order from their current level to expert, each stage one real level of understanding that builds on the one before (skip what they already know). Tag each stage with its level. Each stage has 3-6 sub-steps: the concrete concepts to learn (name them precisely, e.g. "aggregates and invariants", not "core concepts"), the canonical books, talks or papers worth reading (only ones you are sure exist), and hands-on exercises or projects that prove the stage. The last stage is expert-level practice: teaching, writing, deciding trade-offs in real systems. Fit the road into the time frame; if that is unrealistic, say so in "reality".
${shape}` : `You are a seasoned career coach who has guided hundreds of people through exactly this kind of move. ${lang}
The person wants to ${PATHS[r.path] || r.pathOther || 'reach a new career goal'}.
Where they are now:
<now>
${r.now}
</now>
Where they want to be:
<target>
${r.target}
</target>
Time frame: about ${r.months} months, at ${r.hours} hours per week.
${roles.roleContext(me)} ${roles.addressRule(me)}
Build an honest, concrete roadmap from where they are to where they want to be, as a road: 4-7 stages in order, each a clear milestone that builds on the one before, the last one being them arriving at the target. Each stage has 3-6 sub-steps: specific actions (skills to learn, things to build, people to meet, applications to send), not vague advice. Fit the whole road into the time frame and their weekly hours; if that is unrealistic, say so in "reality".
${shape}`, undefined, { signal: ac.signal });
      r.plan = {
        title: clip(x.title, 100) || 'My roadmap', summary: clip(x.summary, 600), reality: clip(x.reality, 300), finish: clip(x.finish, 300),
        stages: (x.stages || []).filter(s => s?.title).slice(0, 8).map((s, i) => ({ title: clip(s.title, 80), level: clip(s.level, 20), goal: clip(s.goal, 300), duration: clip(s.duration, 40),
          steps: (s.steps || []).filter(t => t?.title).slice(0, 7).map((t, j) => ({ id: `${i}.${j}`, title: clip(t.title, 120), detail: clip(t.detail, 500) })) })).filter(s => s.steps.length),
      };
      if (!r.plan.stages.length) throw new SyntaxError('no stages');
      if (ac.signal.aborted) return;
      const list = loadRoadmaps(); list.unshift(r); write('roadmap.json', list.slice(0, 30)); res.json(r);
    } catch (e) { if (!ac.signal.aborted) res.status(500).json({ error: e instanceof SyntaxError ? 'The reply came back garbled. Try again.' : e.message }); }
  });
};
module.exports.schedule = schedule;
module.exports.STEPS = STEPS;
