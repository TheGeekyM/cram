// What an interview round is.
//
// Six built-in rounds came from a tech-hiring app; a role can now bring its own (a nutritionist gets
// "Client Consultation", a pharmacist "Counselling"). Every interview snapshots the round it was
// started with — label, kind, rubric, guide — so editing or re-deriving a role later never changes how
// an interview already in progress is run or graded. resolve() is the one lookup: snapshot first,
// built-in second, technical as the last resort, which is what every pre-existing record falls back to.

const QA = 'qa', CONSULT = 'consult';

const BUILTIN = {
  technical: {
    label: 'Technical', kind: QA,
    rubric: ['Correctness', 'Depth', 'Trade-offs', 'Clarity'],
    guide: 'Probe real knowledge for the role: concepts, how things work under the hood, debugging, trade-offs. Mix breadth and depth.',
  },
  behavioral: {
    label: 'Behavioral', kind: QA,
    rubric: ['Situation & task', 'Actions', 'Result & impact', 'Ownership', 'Clarity'],
    guide: 'Ask "Tell me about a time…" questions on competencies (ownership, conflict, failure, influence, delivery). Expect STAR answers; follow up on vague parts, the candidate\'s own actions and measurable results.',
  },
  situational: {
    label: 'Situational', kind: QA,
    rubric: ['Judgment', 'Prioritization', 'Stakeholders', 'Communication'],
    guide: 'Pose realistic hypothetical workplace scenarios for the role ("What would you do if…"). Follow up by changing the constraints.',
  },
  management: {
    label: 'Management', kind: QA,
    rubric: ['People leadership', 'Delivery', 'Conflict handling', 'Strategy', 'Communication'],
    guide: 'Cover hiring, growing and managing people, underperformers, prioritization, delivery under pressure and cross-team influence, calibrated to the seniority.',
  },
  'system-design': {
    label: 'System design', kind: QA,
    rubric: ['Requirements', 'High-level design', 'Scalability', 'Trade-offs', 'Communication'],
    guide: 'Run ONE design problem as a staged interview: 1) clarify requirements and scale, 2) API and data model, 3) high-level components, 4) deep dive on a bottleneck, 5) scaling, failure modes and trade-offs. Move to the next stage only once the current one is covered; stay on the same problem for the whole interview.',
  },
  architecture: {
    label: 'Architecture', kind: QA,
    rubric: ['Requirements', 'Architecture choices', 'Non-functional needs', 'Trade-offs', 'Communication'],
    guide: 'Run an architecture discussion on ONE realistic system for the role: context and constraints, architecture style, integration and data flow, non-functional requirements (security, reliability, cost, evolvability), then decisions and trade-offs. Stay on the same system across stages.',
  },
};

// The fallback rubric for a consultation the role did not spell out. A role's own rubric always wins:
// a pharmacist is judged on drug interactions, a nutritionist on dietary assessment.
const CONSULT_RUBRIC = ['History taking', 'Safety & red flags', 'Empathy & communication', 'Reasoning', 'Explanation & plan'];
const consultGuide = word => `Play the ${word} yourself, in character, for the whole session. Reveal only what the learner asks about or what this person would volunteer, react as they would to explanations, and never coach, grade or hint. The learner is the professional running the encounter.`;

// What this interview is, from the interview record. Snapshot fields win, so a role edited or
// re-derived later cannot change a session that already exists.
function resolve(iv = {}) {
  const b = BUILTIN[iv.round] || null;
  const kind = iv.kind === CONSULT ? CONSULT : (iv.kind === QA ? QA : (b?.kind || QA));
  return {
    kind,
    label: iv.roundLabel || b?.label || iv.round || 'Interview',
    rubric: (Array.isArray(iv.rubric) && iv.rubric.length ? iv.rubric : null) || b?.rubric || (kind === CONSULT ? CONSULT_RUBRIC : BUILTIN.technical.rubric),
    guide: iv.guide || b?.guide || (kind === CONSULT ? consultGuide(iv.clientWord || 'client') : BUILTIN.technical.guide),
  };
}

// The round the learner picked, as it will be stored on the interview. Looks in the profile's own
// rounds first, then the built-ins; returns null when it is neither, so the route can 400.
function pick(id, profileRounds) {
  const own = (profileRounds || []).find(r => r.id === id);
  if (own) return { round: own.id, roundLabel: own.label, kind: own.kind === CONSULT ? CONSULT : QA, rubric: own.rubric?.length ? own.rubric : null, guide: own.guide || null };
  const b = BUILTIN[id];
  if (b) return { round: id, roundLabel: b.label, kind: b.kind, rubric: b.rubric, guide: b.guide };
  return null;
}

module.exports = { QA, CONSULT, BUILTIN, CONSULT_RUBRIC, consultGuide, resolve, pick };
