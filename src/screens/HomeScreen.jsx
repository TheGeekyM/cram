import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { ask } from '../components/Confirm.jsx'

// Student dashboard: coach banner, continue-learning
// cards, weekly ring, to-do list. Stats come from /api/dashboard, advice from /api/coach.
const Ico = ({ d, s = 16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const I = {
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
  book: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  chart: <><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  ask: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  quiz: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  interview: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>,
  code: <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>,
  new: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></>,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.2-.3-4.6 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.3-2.4 1-3.5.5 1.6 1.5 2.5 2.5 3Z"/>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  play: <path d="m6 3 14 9-14 9V3z"/>,
  review: <><rect x="2" y="6" width="14" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v14"/></>,
  target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
  export: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>,
}
const TOOLS = { ask: 'Ask', interview: 'Interview', code: 'Code', review: 'Review', new: 'New study' }
const START = { ask: 'Ask about it', interview: 'Start interview', code: 'Start challenge', review: 'Start review', new: 'Create this study' }
// Quiz was removed: an old quiz session or activity row opens Review, where its missed questions live now
const toolOf = k => k === 'quiz' ? 'review' : k
const GOALS = { avg: ['average score', '%', s => s.avg || 0], minutes: ['minutes studied', ' min', s => s.minutes], sessions: ['sessions', '', s => s.sessions] }
const daysTo = d => d ? Math.ceil((new Date(`${d}T00:00`) - new Date().setHours(0, 0, 0, 0)) / 864e5) : null
const ago = t => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }
const pctColor = p => p == null ? 'text-dim' : p >= 70 ? 'text-success' : p >= 40 ? 'text-warning' : 'text-error'
const Ring = ({ pct, size = 44, stroke = 4, color = 'rgb(var(--c-success))', children }) => { const r = (size - stroke) / 2, C = 2 * Math.PI * r; return (
  <div className="relative grid place-items-center flex-shrink-0" style={{ width: size, height: size }}>
    <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-border))" strokeWidth={stroke} /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, pct)))} style={{ transition: 'stroke-dashoffset .6s' }} /></svg>
    <div className="absolute inset-0 grid place-items-center">{children}</div>
  </div>) }

// ---------- pieces ----------
function Goal({ s, onChanged }) {
  const [edit, setEdit] = useState(false); const [kind, setKind] = useState(s.goal?.kind || 'avg'); const [target, setTarget] = useState(s.goal?.target || 80)
  const saveGoal = async g => { const r = await api.post(`/api/studies/${s.id}/goal`, g); if (r.error) return alert(r.error); setEdit(false); onChanged() }
  if (edit) return (
    <div className="relative flex items-center gap-1.5 flex-wrap text-xs">
      <select className="input w-auto py-1 text-xs" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(GOALS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
      <input type="number" min="1" className="input w-20 py-1 text-xs" value={target} onChange={e => setTarget(e.target.value)} />
      <button className="btn-tint btn-green" onClick={() => saveGoal({ kind, target })}>Save</button>
      {s.goal && <button className="btn-tint" onClick={() => saveGoal({})}>Clear</button>}
      <button className="text-dim hover:text-white px-1" onClick={() => setEdit(false)}>✕</button>
    </div>
  )
  if (!s.goal) return <button onClick={() => setEdit(true)} className="relative text-[11px] text-dim hover:text-accent self-start inline-flex items-center gap-1"><Ico s={11} d={I.target} />Set a goal</button>
  const [label, unit, value] = GOALS[s.goal.kind], v = value(s), pct = Math.min(100, Math.round(v / s.goal.target * 100))
  return (
    <button onClick={() => setEdit(true)} className="relative text-left flex flex-col gap-1" title="Change goal">
      <div className="flex items-center text-[11px]"><span className="text-dim inline-flex items-center gap-1"><Ico s={11} d={I.target} />Goal: {s.goal.target}{unit} {label}</span><b className={`ml-auto font-mono ${pct >= 100 ? 'text-success' : 'text-white'}`}>{v}{unit} · {pct}%</b></div>
      <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success' : 'bg-accent'}`} style={{ width: `${pct}%` }} /></div>
    </button>
  )
}
function StudyCard({ s, onOpen, onChanged }) {
  const tool = toolOf(s.open.find(k => k !== 'quiz') || 'ask')
  return (
    <div className="island p-4 flex flex-col gap-3 relative overflow-hidden group hover:border-accent/40 transition-colors">
      <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl ${s.avg == null ? 'bg-accent/15' : s.avg >= 70 ? 'bg-success/15' : s.avg >= 40 ? 'bg-warning/15' : 'bg-error/15'}`} />
      <div className="relative flex items-start gap-3">
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white truncate">{s.title}</div><div className="text-[11px] text-dim truncate">{s.subject || (s.hasPdf ? 'PDF' : '')}</div></div>
        {s.open.filter(k => k !== 'quiz').length > 0 && <span className="badge badge-green flex-shrink-0">{s.open.filter(k => k !== 'quiz').length} open</span>}
      </div>
      <div className="relative flex items-center gap-3">
        <Ring pct={(s.avg ?? 0) / 100} size={46} color={s.avg == null ? 'rgb(var(--c-border))' : s.avg >= 70 ? 'rgb(var(--c-success))' : s.avg >= 40 ? 'rgb(var(--c-warning))' : 'rgb(var(--c-error))'}><span className={`text-[11px] font-semibold font-mono ${pctColor(s.avg)}`}>{s.avg == null ? '–' : `${s.avg}%`}</span></Ring>
        <div className="text-[11px] text-dim leading-relaxed"><div>{s.minutes} min · {s.sessions} session{s.sessions === 1 ? '' : 's'}</div><div>{s.interviews} interview · {s.challenges} code{s.quizzes ? ` · ${s.quizzes} old quiz` : ''}</div><div>last {ago(s.lastAt)}</div></div>
      </div>
      <Goal key={JSON.stringify(s.goal)} s={s} onChanged={onChanged} />
      <button onClick={() => onOpen(s.id, tool)} className="relative btn btn-primary text-xs py-1.5 self-start inline-flex items-center gap-1.5"><Ico s={12} d={I[tool]} />{tool !== 'ask' ? `Continue ${TOOLS[tool].toLowerCase()}` : 'Continue'}</button>
    </div>
  )
}
function Row({ s, onOpen, onDelete, onExport }) {
  const [menu, setMenu] = useState(false)
  return (
    <div onClick={() => onOpen(s.id)} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 cursor-pointer relative">
      <span className="text-dim"><Ico d={s.hasPdf ? I.pdf : I.book} /></span>
      <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-white truncate">{s.title}</div><div className="text-[11px] text-dim truncate">{s.subject || (s.hasPdf ? 'PDF' : '')}{s.subject && s.hasPdf ? ' · PDF' : ''}</div></div>
      <span className="text-[11px] text-dim">{new Date(s.updatedAt).toLocaleDateString()}</span>
      <button onClick={e => { e.stopPropagation(); setMenu(m => !m) }} className="w-7 h-7 rounded text-dim opacity-0 group-hover:opacity-100 hover:bg-white/10 grid place-items-center">⋯</button>
      {menu && <div onMouseLeave={() => setMenu(false)} className="absolute right-2 top-10 z-20 panel py-1 text-xs min-w-[150px]">
        <button onClick={e => { e.stopPropagation(); onOpen(s.id) }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5">Open</button>
        <button onClick={e => { e.stopPropagation(); setMenu(false); onExport(s) }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5">Export practice to Notes</button>
        <button onClick={e => { e.stopPropagation(); setMenu(false); onDelete(s) }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5 text-error">Delete study</button></div>}
    </div>
  )
}
const H = ({ children, right }) => <div className="flex items-center gap-2 mb-2.5 mt-1"><h3 className="text-sm font-semibold text-white flex-1">{children}</h3>{right}</div>

// ---------- sections ----------
function Dashboard({ profile, dash, coach, coaching, onCoach, onOpenTool, onNew, onProfile, report, reporting, onReport, onChanged }) {
  const named = !!profile?.name, target = +profile?.hoursPerWeek || 5, hours = (dash?.weekMinutes || 0) / 60, stale = dash?.lastAt && Date.now() - dash.lastAt > 864e5
  const go = (sid, tool, topic) => tool === 'new' || !sid || !dash.studies.some(s => s.id === sid) ? onNew('subject', { title: topic || '', subject: '' }) : onOpenTool(sid, tool === 'new' ? 'ask' : tool)
  const next = coach?.next, days = dash?.days || [], maxDay = Math.max(...days.map(x => x.minutes), 1)
  const Empty = ({ children }) => <div className="island px-4 py-6 text-center text-xs text-dim">{children}</div>
  const exam = daysTo(profile?.examDate)
  const tiles = [[`${Math.round((dash?.totalMinutes || 0) / 60 * 10) / 10}h`, 'total study time'], [`${dash?.weekMinutes || 0} min`, 'this week'], [dash?.streak || 0, 'day streak'], [dash?.studies.length || 0, 'studies'],
    ...(exam != null && exam >= 0 ? [[exam === 0 ? 'today' : `${exam}d`, `to ${profile.examName || 'your exam'}`, exam <= 14 ? 'text-error' : exam <= 45 ? 'text-warning' : 'text-white']] : [])]
  const delta = (a, b, unit = '') => b == null || a == null ? '' : a === b ? ' · same as before' : ` · ${a > b ? '▲' : '▼'} ${Math.abs(a - b)}${unit} vs week before`
  const r = report?.report
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {stale && <div className="island px-4 py-2.5 flex items-center gap-3 border-warning/40 animate-fade-up"><span className="text-warning"><Ico d={I.bell} /></span><span className="text-xs text-gray-200 flex-1">{coach?.nudge || `It's been ${ago(dash.lastAt)} since your last session. Ten minutes today keeps the streak alive.`}</span></div>}
        <div className="island relative overflow-hidden p-6" style={{ background: 'linear-gradient(120deg, rgb(var(--c-accent) / .28), rgb(var(--c-accent-2) / .22) 60%, rgb(var(--c-panel)) 100%)' }}>
          <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-accent/25 blur-3xl" style={{ animation: 'dash-breathe 6s ease-in-out infinite' }} />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-300">{named ? `Hello ${profile.name.split(' ')[0]} · study next` : 'Welcome to Cram'}</div>
            {!named ? <>
              <h2 className="text-2xl font-semibold text-white mt-1">Tell me who you are and where you're going.</h2>
              <p className="text-sm text-gray-200 mt-1 max-w-xl">Your career, your goal and your weekly target let the coach pick what you study next, what to add, and how to get better.</p>
              <button onClick={onProfile} className="btn btn-primary mt-4 inline-flex items-center gap-1.5">Set up my profile</button>
            </> : coach ? <>
              <h2 className="text-2xl font-semibold text-white mt-1">{next?.title || coach.headline}</h2>
              <p className="text-sm text-gray-200 mt-1 max-w-xl">{next?.why || ''}</p>
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button onClick={() => go(next?.studyId, next?.tool, next?.title)} className="btn btn-primary inline-flex items-center gap-1.5"><Ico s={13} d={I[next?.tool] || I.play} />{START[next?.tool] || 'Start now'}</button>
                <span className="text-xs text-gray-300 italic">{coach.headline}</span>
                <button onClick={() => onCoach(true)} disabled={coaching} className="ml-auto btn-tint" title="Ask the coach again"><span className={coaching ? 'animate-spin inline-flex' : 'inline-flex'}><Ico s={12} d={I.refresh} /></span>{coaching ? 'Thinking…' : 'Refresh'}</button>
              </div>
            </> : <>
              <h2 className="text-2xl font-semibold text-white mt-1">{coaching ? 'Your coach is looking at your progress…' : dash?.studies.length ? 'Ready when you are.' : 'Start with one subject.'}</h2>
              <p className="text-sm text-gray-200 mt-1 max-w-xl">{coaching ? 'One moment: scores, streak, unfinished sessions and your goal, then a plan.' : dash?.studies.length ? 'The coach needs a signed-in Claude to build your plan.' : 'Add a subject or a PDF, then the coach takes over.'}</p>
              {!coaching && !dash?.studies.length && <button onClick={() => onNew('subject')} className="btn btn-primary mt-4 inline-flex items-center gap-1.5"><Ico s={13} d={I.new} />New study</button>}
            </>}
          </div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>{tiles.map(([v, l, c]) => <div key={l} className="island p-4"><div className={`text-2xl font-bold font-mono ${c || 'text-white'}`}>{v}</div><div className="text-[11px] uppercase tracking-wider text-dim truncate">{l}</div></div>)}</div>
        <div><H right={named && <button onClick={() => onReport(true)} disabled={reporting} className="btn-tint"><span className={reporting ? 'animate-spin inline-flex' : 'inline-flex'}><Ico s={12} d={I.refresh} /></span>{reporting ? 'Writing…' : r ? 'Rewrite' : 'Write it now'}</button>}>Weekly report{report?.week && <span className="text-dim font-normal text-xs ml-2">week of {new Date(`${report.week}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</H>
          {r ? <div className="island p-4 flex flex-col gap-3">
            <p className="text-sm text-gray-200" dir="auto">{r.summary}</p>
            <div className="flex gap-2 flex-wrap text-[11px]">
              <span className="badge">{r.stats.minutes} min{delta(r.stats.minutes, r.stats.prevMinutes, ' min')}</span>
              <span className="badge">{r.stats.sessions} sessions{delta(r.stats.sessions, r.stats.prevSessions)}</span>
              {r.stats.avg != null && <span className="badge">avg {r.stats.avg}%{delta(r.stats.avg, r.stats.prevAvg, '%')}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[['Improved', r.improved, 'text-success', '▲'], ['Slipped', r.slipped, 'text-error', '▼']].map(([t, list, c, m]) => <div key={t} className="rounded-lg bg-app border border-border p-3"><div className={`text-[11px] uppercase tracking-wider mb-1.5 ${c}`}>{t}</div>{list?.length ? list.map((x, i) => <div key={i} className="text-xs text-gray-200 flex gap-2 py-0.5" dir="auto"><span className={c}>{m}</span>{x}</div>) : <div className="text-xs text-dim">Nothing to call out.</div>}</div>)}
            </div>
            <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm text-gray-100" dir="auto"><b className="text-accent text-[11px] uppercase tracking-wider mr-2">Focus this week</b>{r.focus}</div>
          </div> : <Empty>{reporting ? 'Writing your report from last week\'s sessions…' : named ? 'Every Monday the coach compares last week with the week before. Press "Write it now" to get this week\'s.' : 'Set up your profile to get a weekly report.'}</Empty>}</div>
        <div><H>Continue learning</H>{dash?.studies.length ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>{dash.studies.slice(0, 6).map(s => <StudyCard key={s.id} s={s} onOpen={onOpenTool} onChanged={onChanged} />)}</div>
          : <Empty>No studies yet. <button onClick={() => onNew('subject')} className="text-accent hover:underline">Create one</button> from a subject or a PDF.</Empty>}</div>
        <div><H>How to get better</H>{coach?.tips?.length ? <div className="island divide-y divide-border">{coach.tips.map((t, i) => <div key={i} className="flex gap-3 px-4 py-3 text-sm text-gray-200"><span className="w-6 h-6 rounded-md bg-accent/15 text-accent grid place-items-center text-xs font-bold flex-shrink-0">{i + 1}</span><span>{t}</span></div>)}</div>
          : <Empty>{named ? (coaching ? 'The coach is writing your tips…' : 'Tips appear after your first interview or challenge.') : 'Set up your profile and the coach writes tips from your results.'}</Empty>}</div>
        {coach?.suggestNew?.length > 0 && <div><H>Worth adding for your goal</H><div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>{coach.suggestNew.map((s, i) => <div key={i} className="island p-4 flex flex-col gap-2"><div className="text-sm font-semibold text-white">{s.title}</div><div className="text-xs text-dim flex-1">{s.why}</div><button onClick={() => onNew('subject', { title: s.title, subject: s.subject })} className="btn-tint self-start"><Ico s={12} d={I.new} />Create study</button></div>)}</div></div>}
        <div><H>Recent activity</H>{dash?.events.length ? <div className="island divide-y divide-border">{dash.events.slice(0, 8).map(e => (
          <button key={e.kind + e.id} onClick={() => onOpenTool(e.studyId, toolOf(e.kind))} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5">
            <span className="w-7 h-7 rounded-lg bg-panel-2 text-dim grid place-items-center flex-shrink-0"><Ico s={13} d={I[e.kind]} /></span>
            <div className="min-w-0 flex-1"><div className="text-sm text-gray-100 truncate">{e.title}</div><div className="text-[11px] text-dim">{e.study} · {ago(e.at)}{e.done ? '' : ' · unfinished'}</div></div>
            <span className={`text-sm font-mono font-semibold ${pctColor(e.score == null ? null : e.score * 100)}`}>{e.score == null ? '–' : `${Math.round(e.score * 100)}%`}</span>
          </button>))}</div> : <Empty>Interviews and challenges you run show up here.</Empty>}</div>
      </div>
      <div className="w-72 flex-shrink-0 flex flex-col gap-4">
        <button onClick={onProfile} className="island p-4 flex items-center gap-3 text-left hover:border-accent/40 transition-colors">
          <div className="w-11 h-11 rounded-full bg-accent text-app grid place-items-center text-lg font-bold flex-shrink-0">{named ? profile.name[0].toUpperCase() : '?'}</div>
          <div className="min-w-0"><div className="text-sm font-semibold text-white truncate">{named ? profile.name : 'No profile yet'}</div><div className="text-[11px] text-dim truncate">{named ? profile.goal : 'Click to tell the coach about you'}</div></div>
        </button>
        <div className="island p-4">
          <div className="text-sm font-semibold text-white mb-3">This week</div>
          <div className="flex items-center gap-4">
            <Ring pct={hours / target} size={104} stroke={9}><div className="text-center leading-tight"><div className="text-2xl font-bold text-white font-mono">{hours < 10 ? hours.toFixed(1) : Math.round(hours)}</div><div className="text-[9px] uppercase tracking-wider text-dim">hours</div></div></Ring>
            <div className="text-[11px] flex flex-col gap-1.5">
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-border" /><span className="text-dim">Target</span><b className="text-white ml-auto">{target}h</b></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-success" /><span className="text-dim">Achieved</span><b className="text-white ml-auto">{hours.toFixed(1)}h</b></div>
              <div className="flex items-center gap-2 mt-1"><span className="text-warning"><Ico s={13} d={I.flame} /></span><span className="text-dim">Streak</span><b className="text-white ml-auto">{dash?.streak || 0} day{dash?.streak === 1 ? '' : 's'}</b></div>
            </div>
          </div>
          <div className="flex items-end gap-1 h-10 mt-4">{days.map(d => <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${d.day}: ${d.minutes} min`}><div className={`w-full rounded-sm ${d.minutes ? 'bg-success' : 'bg-border'}`} style={{ height: `${Math.max(8, d.minutes / maxDay * 100)}%` }} /><span className="text-[9px] text-dim">{'SMTWTFS'[new Date(d.day + 'T12:00').getDay()]}</span></div>)}</div>
        </div>
        <div className="island p-4">
          <div className="text-sm font-semibold text-white mb-2">Your to-do list</div>
          {coach?.todos?.length ? <div className="flex flex-col">{coach.todos.map((t, i) => (
            <button key={i} onClick={() => go(t.studyId, t.tool, t.text)} className="flex items-center gap-3 py-2 text-left group">
              <span className="w-8 h-8 rounded-lg bg-accent/15 text-accent grid place-items-center flex-shrink-0 group-hover:bg-accent group-hover:text-app transition-colors"><Ico s={14} d={I[t.tool] || I.play} /></span>
              <div className="min-w-0"><div className="text-xs text-gray-100 leading-snug">{t.text}</div><div className="text-[10px] text-dim">{TOOLS[t.tool] || ''}{t.studyId && dash?.studies.find(s => s.id === t.studyId) ? ` · ${dash.studies.find(s => s.id === t.studyId).title}` : ''}</div></div>
            </button>))}</div>
            : <div className="text-xs text-dim py-2">{coaching ? 'Building your list…' : named ? 'Once the coach has run, your plan shows up here.' : 'Set up your profile to get a plan.'}</div>}
        </div>
      </div>
      <style>{`@keyframes dash-breathe { 0%,100% { transform: scale(1); opacity: .7 } 50% { transform: scale(1.15); opacity: 1 } }`}</style>
    </div>
  )
}
function Studies({ studies, q, setQ, onOpen, onNew, onDelete, onExport }) {
  const list = useMemo(() => { const k = q.trim().toLowerCase(); return k ? studies.filter(s => (s.title + ' ' + (s.subject || '')).toLowerCase().includes(k)) : studies }, [studies, q])
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {[['subject', I.book, 'New subject…', 'Name a topic and start studying'], ['pdf', I.pdf, 'From a PDF…', 'Attach lecture notes, a book, a paper']].map(([m, ic, t, sub]) => (
          <button key={m} onClick={() => onNew(m)} className="island p-4 text-left flex items-start gap-3 hover:border-accent/40 transition-colors group">
            <div className="w-9 h-9 rounded-lg bg-accent/15 text-accent grid place-items-center flex-shrink-0 group-hover:bg-accent group-hover:text-app transition-colors"><Ico d={ic} /></div>
            <div className="min-w-0"><div className="text-sm font-semibold text-white">{t}</div><div className="text-xs text-dim mt-0.5">{sub}</div></div>
          </button>))}
      </div>
      <div className="island p-1.5">
        {list.length ? list.map(s => <Row key={s.id} s={s} onOpen={onOpen} onDelete={onDelete} onExport={onExport} />)
          : <div className="text-center text-xs text-dim py-10">{q ? `Nothing matches «${q}».` : 'No studies yet — start from a subject or a PDF.'}</div>}
      </div>
    </div>
  )
}
// ---------- page ----------
export default function HomeScreen({ section, studies, settings, profile, onEditProfile, onOpen, onOpenTool, onNew, onDeleted }) {
  const [q, setQ] = useState(''); const [dash, setDash] = useState(null); const [coach, setCoach] = useState(null); const [coaching, setCoaching] = useState(false)
  const [report, setReport] = useState(null); const [reporting, setReporting] = useState(false)
  const loadDash = useCallback(() => api.get('/api/dashboard').then(setDash), [])
  useEffect(() => { loadDash() }, [studies, loadDash])
  useEffect(() => { api.get('/api/report').then(r => !r.error && setReport(r)) }, [])
  const runReport = useCallback(async force => {
    setReporting(true); const r = await api.post('/api/report', { force }); setReporting(false)
    if (r.error) return force && alert(r.error); setReport(r)
  }, [])
  // the weekly report writes itself once per week, after the coach call so the two never run together
  useEffect(() => {
    if (!report || report.report || !profile?.name || !settings?.hasKey || coaching || !dash?.events.length || sessionStorage.getItem(`cram:report:${report.week}`)) return
    sessionStorage.setItem(`cram:report:${report.week}`, '1'); runReport(false)
  }, [report, profile?.name, settings?.hasKey, coaching, dash, runReport])
  const exportNotes = async s => {
    const r = await api.post(`/api/studies/${s.id}/export-notes`, {})
    if (r.error) return ask({ title: 'Nothing exported', body: r.error, ok: 'OK', danger: false })
    window.dispatchEvent(new Event('cram:notes-changed'))
    if (await ask({ title: 'Exported to Notes', body: `«${r.note.title}» now holds every interview, challenge and past quiz from this study.`, ok: 'Open Notes', cancel: 'Stay here', danger: false })) onOpenTool(null, 'notes')
  }
  const runCoach = useCallback(async force => {
    if (!settings?.hasKey || !profile?.name) return
    setCoaching(true); const c = await api.post('/api/coach', { force }); setCoaching(false); if (!c.error) setCoach(c)
  }, [settings?.hasKey, profile?.name])
  useEffect(() => { setCoach(null) }, [profile?.updatedAt])
  useEffect(() => { if (dash && profile?.name && (!coach || dash.lastAt !== coach._lastAt)) runCoach(false).then(() => setCoach(c => c && { ...c, _lastAt: dash.lastAt })) }, [dash, profile?.name, profile?.updatedAt, runCoach]) // eslint-disable-line
  // one desktop reminder per app session when the last study was over a day ago
  useEffect(() => {
    if (!dash?.lastAt || Date.now() - dash.lastAt < 864e5 || !profile?.name || sessionStorage.getItem('cram:nudged')) return
    sessionStorage.setItem('cram:nudged', '1')
    try { const show = () => new Notification('Cram', { body: coach?.nudge || `${profile.name}, it's been ${ago(dash.lastAt)} since you studied. Ten minutes today?` }); if (Notification.permission === 'granted') show(); else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show()) } catch {}
  }, [dash, profile, coach])
  const askDelete = async s => { if (!await ask({ title: `Delete «${s.title}»?`, body: 'Chat, interviews, challenges, past quizzes and the PDF copy are removed. This can\'t be undone.', ok: 'Delete study' })) return; await api.del(`/api/studies/${s.id}`); onDeleted(s.id) }
  const [sec, setSec] = useState(section); useEffect(() => setSec(section), [section])
  return (
    <div className="h-full overflow-y-auto hero-glow">
      <div className="px-6 py-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-md"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"><Ico s={14} d={I.search} /></span><input className="input pl-9 bg-panel" placeholder="Search studies…" value={q} onChange={e => { setQ(e.target.value); if (e.target.value) setSec('studies') }} /></div>
          <div className="flex-1" />
          <button onClick={() => onNew('subject')} className="btn btn-primary text-xs py-1.5 inline-flex items-center gap-1.5"><Ico s={13} d={I.new} />New study</button>
          {settings && <span className={`badge ${settings.hasKey ? 'badge-green' : 'badge-red'}`}>{settings.hasKey ? `${settings.source === 'cli' ? 'CLI' : settings.source === 'claude' ? 'Claude' : 'key'} · ${settings.model.replace('claude-', '')}` : 'not signed in'}</span>}
        </div>
        {sec === 'dashboard' && <Dashboard profile={profile} dash={dash} coach={coach} coaching={coaching} onCoach={runCoach} onOpenTool={onOpenTool} onNew={onNew} onProfile={onEditProfile} report={report} reporting={reporting} onReport={runReport} onChanged={loadDash} />}
        {sec === 'studies' && <Studies studies={studies} q={q} setQ={setQ} onOpen={onOpen} onNew={onNew} onDelete={askDelete} onExport={exportNotes} />}
      </div>
    </div>
  )
}
