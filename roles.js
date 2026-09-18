// What Cram becomes for one person.
//
// The role is derived once by the model from the onboarding answers and cached on the profile as a set
// of plain capabilities — writesCode, seesClients, the rounds an interview can have. The UI reads only
// those, so there is no list of professions anywhere in the app and a job nobody anticipated works the
// same as a familiar one. Everything falls back to a static default, so no API key, a failed call or a
// garbled reply never blocks the app: you just get the general-purpose Cram until it succeeds.
const crypto = require('crypto');

const BUILTIN_ROUNDS = ['technical', 'behavioral', 'situational', 'management', 'system-design', 'architecture'];
const KINDS = ['qa', 'consult'];
const ALWAYS = ['interview', 'review', 'notes', 'blog']; // every role gets these; `code` is the only conditional one
const MAX_ROUNDS = 6, MAX_STUDIES = 5;

// Only the answers that would change the model's reply. Editing hours/week or an exam date must not
// spend a derivation, so those are deliberately absent.
const roleKey = p => crypto.createHash('sha1')
  .update([p?.target, p?.career, p?.stage, p?.country, p?.notes].map(x => String(x || '')).join(' '))
  .digest('hex').slice(0, 12);

// The app before (or without) a derived role: everything on, the six built-in rounds, no suggestions.
const DEFAULT_ROLE = { title: '', field: '', writesCode: true, seesClients: false, clientWord: 'client', levels: null, rounds: [], suggestedStudies: [], from: 'default', derivedAt: 0 };

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const slug = v => clip(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A model reply is never trusted into the UI as-is: ids become slugs, kinds must be known, lists are
// clipped, and anything without a label is dropped.
function sanitizeRole(r, from = 'model') {
  const rounds = (Array.isArray(r?.rounds) ? r.rounds : []).map(x => ({
    id: slug(x?.id || x?.label) || 'round',
    label: clip(x?.label || x?.id, 40),
    sub: clip(x?.sub, 80),
    kind: KINDS.includes(x?.kind) ? x.kind : 'qa',
    // 80, not 40: a real rubric criterion is a phrase ("Recognises red flags needing medical referral"),
    // and the first cut chopped them mid-word in the sidebar and in the grader's prompt
    rubric: (Array.isArray(x?.rubric) ? x.rubric : []).map(c => clip(c, 80)).filter(Boolean).slice(0, 6),
    guide: clip(x?.guide, 300),
  })).filter(x => x.label).slice(0, MAX_ROUNDS);
  // ids must be unique: an interview stores the id it was started with, and two rounds sharing one
  // would resolve to the wrong rubric later
  const seen = new Set();
  for (const x of rounds) { let id = x.id, n = 2; while (seen.has(id)) id = `${x.id}-${n++}`; x.id = id; seen.add(id); }
  return {
    title: clip(r?.title, 80),
    field: clip(r?.field, 40),
    writesCode: !!r?.writesCode,
    seesClients: !!r?.seesClients,
    clientWord: clip(r?.clientWord, 20) || 'client',
    levels: Array.isArray(r?.levels) && r.levels.length ? r.levels.map(l => clip(l, 24)).filter(Boolean).slice(0, 5) : null,
    rounds,
    suggestedStudies: (Array.isArray(r?.suggestedStudies) ? r.suggestedStudies : [])
      .map(s => ({ title: clip(s?.title, 80), subject: clip(s?.subject, 200), why: clip(s?.why, 200) }))
      .filter(s => s.title).slice(0, MAX_STUDIES),
    from, derivedAt: Date.now(),
  };
}

// The sidebar's tools. An explicit list on the profile wins, so unticking Code hides it without
// deleting a single challenge, and re-ticking brings them all back.
const toolsFor = (role, explicit) => (Array.isArray(explicit) && explicit.length ? explicit : [...ALWAYS, ...(role?.writesCode === false ? [] : ['code'])]);

// The rounds an interview can be. Falls back to the six built-in ones, so an undeleted old profile,
// a failed derivation and a fresh install all still work.
const roundsFor = role => (role?.rounds?.length ? role.rounds : null);

// One line for every prompt that used to assume an engineer.
function roleContext(p) {
  const r = p?.role, who = r?.title || p?.target;
  if (!who) return '';
  return `The learner${p.career ? ` works as ${p.career} and` : ''} is working towards ${who}${p.country ? ` in ${p.country}` : ''}.`
    + ` Use examples from that practice.${r && r.writesCode === false ? ' They do not write code: never suggest coding exercises or use programming examples.' : ''}`;
}

// Arabic marks the listener's gender in ordinary address — أهلاً بيك to a man, أهلاً بيكي to a woman —
// and so do many other languages. Getting it wrong is jarring in every sentence, so it is told to every
// surface that speaks to the learner. Unset says nothing at all rather than guessing.
const addressRule = p => p?.gender === 'female'
  ? 'The learner is a woman. Speak to her in the feminine form, and refer to her as "she" and "her" when writing about her. In Arabic use feminine forms throughout — verbs, pronouns and adjectives alike (إنتي، عايزة، جاهزة، قلتي، فهمتي، ممكن تشرحيلي) — and never the masculine.'
  : p?.gender === 'male'
    ? 'The learner is a man. Speak to him in the masculine form, and refer to him as "he" and "him" when writing about him. In Arabic use masculine forms throughout — verbs, pronouns and adjectives alike (إنت، عايز، جاهز، قلت، فهمت، ممكن تشرحلي).'
    : '';

// What the coach and the weekly report are allowed to suggest. Built from the role, so a nutritionist's
// coach never proposes a coding challenge. "ask" is always there: it is the study chat, not a sidebar tool.
const TOOL_WORDS = {
  interview: 'interview (a spoken mock interview, graded against a rubric)',
  code: 'code challenge (coding exercises run against tests)',
  review: 'review (spaced-repetition flashcards and missed questions)',
  notes: 'notes (their own written notes)',
  blog: 'blog (long articles about what they study)',
};
const toolSentence = p => [...toolsFor(p?.role, p?.tools).filter(t => TOOL_WORDS[t]).map(t => TOOL_WORDS[t]), 'ask (chat about the material)'].join(', ');

// The tool catalogue as the model sees it, so it can choose which ones this role should have.
const CATALOGUE = `interview: a spoken mock interview, graded against a rubric
code: coding challenges run against tests — only for roles that actually write code
review: spaced-repetition flashcards from what they got wrong
notes: their own written notes
blog: long articles written about what they study, with a discussion under each`;

async function derive({ json, NO_STUDY }, p) {
  const r = await json(NO_STUDY, `Someone is using a study app to work towards a job. Describe that job as capabilities the app can switch on, so it fits their profession instead of assuming software engineering.

Their answers:
- Working towards: ${clip(p?.target, 200) || '(not said)'}
- Doing now: ${clip(p?.career, 200) || '(not said)'}
- Stage: ${clip(p?.stage, 40) || '(not said)'}${p?.country ? `\n- Country: ${clip(p.country, 60)}` : ''}${p?.notes ? `\n- Notes: ${clip(p.notes, 400)}` : ''}

The tools the app has:
${CATALOGUE}

An interview round is one of two kinds:
- "qa": an interviewer asks questions and the learner answers (technical knowledge, behaviour, judgement).
- "consult": the app plays a ${'${clientWord}'} — a patient, client or customer — and the learner runs the encounter: asking, examining, explaining, agreeing a plan. Use this for any role whose real work is talking to a person in front of them (clinical, legal, counselling, teaching, sales).

Give 3 or 4 rounds that match how this job is really assessed. Reuse these ids where they genuinely fit, so existing material keeps working: ${BUILTIN_ROUNDS.join(', ')}. Invent ids for the rest. Every round needs a rubric of 3 to 5 short criteria this job is actually judged on, and a guide of at most two sentences telling the interviewer how to run it.
Also suggest 3 subjects worth studying first for this target.
"levels" replaces junior/mid/senior/lead when the profession words seniority differently; omit it if those fit.

Keep it compact: short strings, no markdown, no line breaks inside any string. Respond with ONLY JSON and nothing else: {"title": the role in 2-4 words, "field": one word (e.g. healthcare, law, software, finance, education), "writesCode": boolean, "seesClients": boolean, "clientWord": what this job calls the person they serve (patient, client, customer, student...), "levels": [strings] or null, "rounds": [{"id": string, "label": string, "kind": "qa" or "consult", "rubric": [3-5 short strings], "guide": string (max 2 sentences)}], "suggestedStudies": [{"title": string, "subject": string (one line), "why": string (one line)}]}`);
  if (!r || typeof r !== 'object') throw new Error('no role came back');
  const role = sanitizeRole(r);
  if (!role.title && !role.rounds.length) throw new Error('the reply had nothing usable in it');
  return role;
}

module.exports = { BUILTIN_ROUNDS, ALWAYS, DEFAULT_ROLE, roleKey, sanitizeRole, toolsFor, roundsFor, roleContext, addressRule, toolSentence, derive };
