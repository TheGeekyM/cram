import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { ask } from '../components/Confirm.jsx'
import Wait from '../components/Wait.jsx'

// Career roadmap: where you are now → where you want to be, drawn as a road. Each stage is a milestone on the
// road with sub-steps you tick off; a stage whose steps are all done paints its stretch of road in the accent.
const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const I = {
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></>,
  check: <path d="M20 6 9 17l-5-5"/>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></>,
  book: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>,
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>,
  arrow: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
}
const PATHS = [
  ['change', 'Change my career', 'Move into a different field', <><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></>],
  ['grow', 'Grow in my career', 'Go deeper where I already am', <><path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></>],
  ['lead', 'Get promoted / lead', 'Senior, lead or manager', <><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></>],
  ['switch', 'Switch specialization', 'A new track in my field', <><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>],
  ['start', 'Land my first job', 'Starting from zero', <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></>],
  ['freelance', 'Go freelance / own business', 'Work for myself', <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>],
  ['return', 'Come back after a break', 'Return to work', <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></>],
  ['other', 'Something else', 'Describe it yourself', <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></>],
]
const Label = ({ children }) => <span className="text-[11px] uppercase tracking-wider text-dim">{children}</span>
// skill roadmaps tag each stage with its level; the purple deepens toward Expert
const Level = ({ v }) => { const n = Math.max(0, ['beginner', 'intermediate', 'advanced', 'expert'].indexOf(v.toLowerCase())); return <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-accent-2 border border-accent-2/40" style={{ background: `rgb(var(--c-accent-2) / ${0.08 + n * 0.08})` }}>{v}</span> }
const Ring = ({ pct, size }) => (
  <span className="relative block flex-shrink-0" style={{ width: size, height: size }}>
    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgb(var(--c-border))" strokeWidth="3.5" /><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgb(var(--c-accent))" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${pct} 100`} opacity={pct ? 1 : 0} className="transition-all duration-500" /></svg>
    <span className={`absolute inset-0 grid place-items-center font-bold text-white tabular-nums ${size > 40 ? 'text-sm' : 'text-[8px]'}`}>{pct}{size > 40 && '%'}</span>
  </span>
)
const stats = r => { const all = r.plan.stages.flatMap(s => s.steps), done = all.filter(t => r.done.includes(t.id)).length; return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 } }

export default function Roadmap({ profile, onOpenTool }) {
  const [list, setList] = useState(null); const [open, setOpen] = useState('new'); const [menu, setMenu] = useState(null) // right-click menu: { r, x, y }
  useEffect(() => { api.get('/api/roadmap').then(r => { const L = Array.isArray(r) ? r : []; setList(L); if (L[0]) setOpen(L[0].id) }) }, [profile?.id]) // a profile switch brings its own roadmaps
  const road = list?.find(r => r.id === open)
  const update = r => setList(L => L.map(x => x.id === r.id ? r : x))
  const del = async r => {
    if (!await ask({ title: 'Delete this roadmap?', body: 'The road and your ticked steps are removed.', ok: 'Delete' })) return
    await api.del(`/api/roadmap/${r.id}`); setList(L => L.filter(x => x.id !== r.id)); setOpen(o => o === r.id ? 'new' : o) // deleting another road keeps this one open
  }
  useEffect(() => { if (!menu) return; const k = e => e.key === 'Escape' && setMenu(null); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [menu])
  return (
    <div className="h-full flex gap-2.5 p-2 min-h-0">
      <aside className="island w-72 flex-shrink-0 flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-3 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white">Your roads</span>
          {!!list?.length && <span className="text-[11px] text-dim tabular-nums">{list.length}</span>}
        </div>
        <div className="px-3 pb-3">
          <button onClick={() => setOpen('new')} aria-pressed={open === 'new'}
            className={`group w-full flex items-center gap-3 p-2.5 rounded-xl border border-dashed text-start transition-all ${open === 'new' ? 'border-accent bg-accent/10 shadow-accent-glow' : 'border-border hover:border-accent/60 hover:bg-accent/5'}`}>
            <span className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 transition-colors ${open === 'new' ? 'bg-accent text-app' : 'bg-panel-2 text-accent group-hover:bg-accent group-hover:text-app'}`}><Ico s={16} d={I.plus} /></span>
            <span className="min-w-0"><span className="block text-sm font-medium text-white">New roadmap</span><span className="block text-[11px] text-dim">A career move or a skill</span></span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-4">
          {[['skill', 'Skills'], ['career', 'Career moves']].map(([k, label]) => {
            const group = (list || []).filter(r => (r.kind || 'career') === k)
            return group.length > 0 && (
              <div key={k} className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-[0.16em] text-dim px-1 pb-1">{label}</div>
                {group.map(r => { const s = stats(r), on = open === r.id, kind = KINDS.find(x => x[0] === k); return (
                  <div key={r.id} className="relative" onContextMenu={e => { e.preventDefault(); setMenu({ r, x: e.clientX, y: e.clientY }) }}>
                    <button onClick={() => setOpen(r.id)} aria-current={on}
                      className={`w-full flex items-center gap-3 p-2.5 pe-12 rounded-xl text-start transition-colors ${on ? 'bg-panel-2' : 'hover:bg-white/5'}`}>
                      {on && <span className="absolute start-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-accent" />}
                      <span className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 ${k === 'skill' ? 'bg-accent-2/15 text-accent-2' : 'bg-accent/15 text-accent'}`}><Ico s={16} d={kind[3]} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-white leading-snug line-clamp-2" dir="auto">{r.plan.title}</span>
                        <span className="block text-[11px] text-dim truncate mt-0.5" dir="auto">{k === 'skill' ? r.skill : PATHS.find(p => p[0] === r.path)?.[1] || r.pathOther} · {s.done}/{s.total}</span>
                      </span>
                    </button>
                    {/* the selected road trades its ring for a delete button; the big ring in the road's header still shows progress */}
                    <span className="absolute end-2.5 top-1/2 -translate-y-1/2 flex">
                      {on ? <button onClick={() => del(r)} title="Delete roadmap" aria-label={`Delete ${r.plan.title}`} className="w-[30px] h-[30px] rounded-lg grid place-items-center text-dim hover:text-error hover:bg-error/10 transition-colors"><Ico s={15} d={I.trash} /></button>
                        : <span className="block pointer-events-none"><Ring pct={s.pct} size={30} /></span>}
                    </span>
                  </div>) })}
              </div>)
          })}
          {list && !list.length && <div className="flex flex-col items-center gap-2 text-center px-4 py-10 text-dim"><Ico s={22} d={I.flag} /><span className="text-xs">Your roads show up here once you draw one.</span></div>}
        </div>
      </aside>
      {menu && <>
        <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
        <div role="menu" className="fixed z-[61] w-52 island py-1.5 shadow-2xl animate-fade-up" style={{ left: Math.min(menu.x, window.innerWidth - 216), top: Math.min(menu.y, window.innerHeight - 90) }} onContextMenu={e => e.preventDefault()}>
          <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-dim/70 truncate" dir="auto">{menu.r.plan.title}</div>
          <button role="menuitem" autoFocus onClick={() => { const r = menu.r; setMenu(null); del(r) }} className="w-full flex items-center gap-2 text-start px-3 py-1.5 text-xs text-error hover:bg-error hover:text-app focus:bg-error focus:text-app outline-none transition-colors"><Ico s={13} d={I.trash} />Delete roadmap</button>
        </div>
      </>}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {road ? <Road key={road.id} r={road} onOpenTool={onOpenTool} onChange={update} onDelete={() => del(road)} />
          : <NewRoadmap profile={profile} onDone={r => { setList(L => [r, ...(L || [])]); setOpen(r.id) }} />}
      </div>
    </div>
  )
}

const KINDS = [
  ['career', 'Career move', 'From the job you have to the one you want', <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>],
  ['skill', 'Master a skill', 'From beginner to expert in one thing, like DDD', <><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></>],
]
const LEVELS = [['none', 'Never touched it'], ['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']]
const SKILL_IDEAS = ['Domain-Driven Design', 'System design', 'Kubernetes', 'Clean architecture', 'SQL performance', 'Event-driven architecture', 'Public speaking']
const Pills = ({ value, onChange, options }) => (
  <div className="flex flex-wrap gap-0.5 bg-app border border-border rounded-lg p-0.5 w-fit">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{l}</button>)}</div>
)
const Box = ({ icon, title, children }) => (
  <label className="rounded-xl bg-panel-2 border border-border p-3 flex flex-col gap-2 focus-within:border-accent/60">
    <span className="flex items-center gap-1.5 text-xs font-semibold text-white"><span className="text-accent"><Ico s={13} d={icon} /></span>{title}</span>{children}
  </label>
)
const area = 'bg-transparent outline-none resize-none text-sm text-white placeholder:text-dim'
const Choice = ({ on, onClick, icon, name, sub, big }) => (
  <button onClick={onClick} aria-pressed={on} className={`text-start rounded-xl border transition-all ${big ? 'p-4 flex items-center gap-3' : 'p-3'} ${on ? 'bg-accent/15 border-accent shadow-accent-glow' : 'bg-panel-2 border-border hover:border-accent/50'}`}>
    <span className={`${big ? 'w-10 h-10' : 'w-8 h-8 mb-2'} rounded-lg grid place-items-center flex-shrink-0 ${on ? 'bg-accent text-app' : 'bg-app text-dim'}`}><Ico s={big ? 18 : 16} d={icon} /></span>
    <span className="block min-w-0"><span className={`block font-medium text-white leading-tight ${big ? 'text-base' : 'text-sm'}`}>{name}</span><span className="block text-[11px] text-dim mt-0.5 leading-snug">{sub}</span></span>
  </button>
)

function NewRoadmap({ profile, onDone }) {
  const [f, setF] = useState(() => ({ kind: 'career', path: '', pathOther: '', now: profile?.career || '', target: profile?.goal || '', skill: '', level: 'none', about: '', expert: '', months: 12, hours: profile?.hoursPerWeek || 8, language: 'English' }))
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const ctrl = useRef(null)
  useEffect(() => () => ctrl.current?.abort(), [])
  const skill = f.kind === 'skill'
  const ready = skill ? f.skill.trim() : f.path && (f.path !== 'other' || f.pathOther.trim()) && f.now.trim() && f.target.trim()
  const go = async () => {
    setBusy(true); setErr(''); ctrl.current = new AbortController()
    const { months, hours, language } = f
    const body = skill ? { kind: 'skill', skill: f.skill, level: f.level, now: f.about, target: f.expert, months, hours, language } : { kind: 'career', path: f.path, pathOther: f.pathOther, now: f.now, target: f.target, months, hours, language }
    try {
      const r = await fetch('/api/roadmap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.current.signal }).then(x => x.json())
      if (r.error) setErr(r.error); else onDone(r)
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy(false); ctrl.current = null
  }
  if (busy) return (
    <div className="h-full grid place-items-center">
      <div className="flex flex-col items-center gap-5 animate-fade-up">
        <div className="relative w-12 h-40 rounded-full bg-panel-2 border border-border overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] animate-shimmer-y" style={{ background: 'repeating-linear-gradient(to bottom, rgb(var(--c-accent)) 0 12px, transparent 12px 24px)' }} />
        </div>
        <div className="flex items-center gap-2.5 text-sm text-dim"><Wait label="Drawing your road…" /></div>
        <button onClick={() => ctrl.current?.abort()} className="btn btn-ghost text-xs">Cancel</button>
      </div>
    </div>
  )
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-7 animate-fade-up">
      <div>
        <div className="text-2xl font-semibold text-white">Plot your road</div>
        <div className="text-sm text-dim mt-1">{skill ? "Name the skill and where you stand with it. I'll lay out the road from there to expert: the levels, and the concepts, reading and practice at each one." : "Tell me where you stand and where you want to end up. I'll lay out the road between them: big milestones, and the small steps that get you to each one."}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {KINDS.map(([id, name, sub, ic]) => <Choice key={id} big on={f.kind === id} onClick={() => set('kind')(id)} icon={ic} name={name} sub={sub} />)}
      </div>

      {skill ? <>
        <section className="flex flex-col gap-2.5">
          <Label>1 · What do you want to master?</Label>
          <input autoFocus className="input text-base" dir="auto" placeholder="e.g. Domain-Driven Design" value={f.skill} onChange={e => set('skill')(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">{SKILL_IDEAS.map(x => <button key={x} onClick={() => set('skill')(x)} className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${f.skill === x ? 'border-accent text-accent bg-accent/10' : 'border-border text-dim hover:text-white hover:border-accent/50'}`}>{x}</button>)}</div>
        </section>
        <section className="flex flex-col gap-2.5">
          <Label>2 · Where you stand with it</Label>
          <Pills value={f.level} onChange={set('level')} options={LEVELS} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Box icon={I.pin} title="About me (optional)"><textarea rows={4} dir="auto" className={area} placeholder="What you already know around it, your job, why you want this skill…" value={f.about} onChange={e => set('about')(e.target.value)} /></Box>
            <Box icon={I.flag} title="Expert, to me, means (optional)"><textarea rows={4} dir="auto" className={area} placeholder="e.g. lead the modelling of a real product, and teach it to my team" value={f.expert} onChange={e => set('expert')(e.target.value)} /></Box>
          </div>
        </section>
      </> : <>
        <section className="flex flex-col gap-2.5">
          <Label>1 · Which way are you heading?</Label>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {PATHS.map(([id, name, sub, ic]) => <Choice key={id} on={f.path === id} onClick={() => set('path')(id)} icon={ic} name={name} sub={sub} />)}
          </div>
          {f.path === 'other' && <input autoFocus className="input" dir="auto" placeholder="e.g. move abroad and keep working in my field" value={f.pathOther} onChange={e => set('pathOther')(e.target.value)} />}
        </section>
        <section className="flex flex-col gap-2.5">
          <Label>2 · From here to there</Label>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
            <Box icon={I.pin} title="Where I am now"><textarea rows={5} dir="auto" className={area} placeholder="Current job or studies, years of experience, what you're good at, what's holding you back…" value={f.now} onChange={e => set('now')(e.target.value)} /></Box>
            <span className="hidden lg:grid place-items-center text-dim"><Ico s={18} d={I.arrow} /></span>
            <Box icon={I.flag} title="Where I want to be"><textarea rows={5} dir="auto" className={area} placeholder="The role, level or life you're aiming for, and anything that matters about it (remote, salary, a company…)" value={f.target} onChange={e => set('target')(e.target.value)} /></Box>
          </div>
        </section>
      </>}

      <section className="flex flex-col gap-2.5">
        <Label>3 · Pace</Label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-panel-2 border border-border p-3">
          <label className="flex items-center gap-3 text-sm text-white flex-1 min-w-[220px]">In<input type="range" min="1" max="36" value={f.months} onChange={e => set('months')(+e.target.value)} className="flex-1 accent-accent" /><span className="tabular-nums w-20">{f.months} month{f.months > 1 ? 's' : ''}</span></label>
          <label className="flex items-center gap-2 text-sm text-white"><input type="number" min="1" max="80" value={f.hours} onChange={e => set('hours')(+e.target.value)} className="input w-16 py-1 text-center" />hours / week</label>
          <Pills value={f.language} onChange={set('language')} options={[['English', 'English'], ['Arabic', 'Arabic']]} />
        </div>
      </section>

      {err && <div className="text-sm text-error">{err}</div>}
      <button disabled={!ready} onClick={go} className="btn btn-primary self-start inline-flex items-center gap-2 px-5 disabled:opacity-40">Draw my road<Ico d={I.arrow} /></button>
    </div>
  )
}

// One stretch of road. The dashes stay yellow; the surface fills with the accent once that stretch is travelled.
const Asphalt = ({ done, top, bottom }) => (
  <div className={`absolute left-1/2 -translate-x-1/2 w-9 ${top ? 'top-5' : 'top-0'} ${bottom ? 'h-5' : 'bottom-0'} ${done ? 'bg-accent/25' : 'bg-panel-2'} border-x border-border ${top ? 'rounded-t-full border-t' : ''} ${bottom ? 'rounded-b-full border-b' : ''}`}>
    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] opacity-80" style={{ background: 'repeating-linear-gradient(to bottom, rgb(var(--c-accent)) 0 12px, transparent 12px 24px)' }} />
  </div>
)
const Node = ({ on, children }) => <div className={`relative z-10 w-11 h-11 rounded-full grid place-items-center text-sm font-bold border-4 border-panel transition-colors ${on ? 'bg-accent text-app shadow-accent-glow' : 'bg-panel-2 text-white ring-1 ring-border'}`}>{children}</div>

// A row on the road: road in the middle, card on alternating sides (lg), or road left and card right (narrow)
function Row({ side, done, top, bottom, node, aside, children }) {
  return (
    <div className="grid grid-cols-[56px_1fr] lg:grid-cols-[1fr_56px_1fr] gap-x-4">
      <div className={`hidden lg:flex pt-2.5 ${side ? 'lg:order-1 justify-end text-end' : 'lg:order-3'}`}>{aside}</div>
      <div className="relative flex justify-center order-1 lg:order-2 pb-8"><Asphalt done={done} top={top} bottom={bottom} /><div className="relative">{node}</div></div>
      <div className={`order-2 pb-8 min-w-0 ${side ? 'lg:order-3' : 'lg:order-1'}`}>{children}</div>
    </div>
  )
}

function Road({ r, onOpenTool, onChange, onDelete }) {
  const s = stats(r), stages = r.plan.stages, done = new Set(r.done)
  const stageDone = st => st.steps.every(t => done.has(t.id))
  const [openDetail, setOpenDetail] = useState(null)
  const toggle = id => {
    const next = done.has(id) ? r.done.filter(x => x !== id) : [...r.done, id]
    onChange({ ...r, done: next }); api.post(`/api/roadmap/${r.id}`, { done: next })
  }
  const arrived = s.total && s.done === s.total
  const [studying, setStudying] = useState(false)
  const [asking, setAsking] = useState(null); const [ivErr, setIvErr] = useState(null) // the stage whose interview is being set up
  const interview = async (st, i) => { // an interview on one stage's topics, held in the roadmap's study (made on first use)
    setAsking(i); setIvErr(null)
    const x = await api.post(`/api/roadmap/${r.id}/study`)
    if (!x.error && !r.studyId) onChange({ ...r, studyId: x.id })
    const iv = x.error ? x : await api.post(`/api/studies/${x.id}/interviews`, { difficulty: r.kind === 'skill' && r.level === 'advanced' ? 'hard' : 'medium', language: r.language || 'English',
      focus: { title: `"${st.title}": ${st.steps.map(t => t.title).join('; ')}`.slice(0, 160) } })
    setAsking(null)
    if (iv.error) return setIvErr({ i, text: iv.error })
    onOpenTool(x.id, 'interview', iv.id)
  }
  const study = async () => { // one study for the whole road; the server hands back the existing one after the first time
    setStudying(true); const x = await api.post(`/api/roadmap/${r.id}/study`); setStudying(false)
    if (x.error) return alert(x.error)
    if (!r.studyId) onChange({ ...r, studyId: x.id })
    onOpenTool(x.id, 'source') // the chapter list: one chapter per step
  }
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 animate-fade-up">
      <header className="island p-5 mb-8 flex gap-5 items-start">
        <Ring pct={s.pct} size={64} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2"><h1 className="text-xl font-semibold text-white flex-1" dir="auto">{r.plan.title}</h1>
            <button onClick={study} disabled={studying} title={r.studyId ? 'Open the study made from this roadmap' : 'Make one study from this roadmap: every step becomes a chapter'}
              className="btn btn-primary inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-60">{studying ? <span className="w-3 h-3 border-2 border-app/40 border-t-app rounded-full animate-spin" /> : <Ico s={13} d={I.book} />}{r.studyId ? 'Open study' : 'Study this roadmap'}</button>
            <button onClick={onDelete} title="Delete roadmap" aria-label="Delete roadmap" className="w-8 h-8 rounded-md grid place-items-center text-dim hover:text-error hover:bg-white/5"><Ico d={I.trash} /></button></div>
          <p className="text-sm text-gray-300 mt-1" dir="auto">{r.plan.summary}</p>
          <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
            <span className="px-2 py-1 rounded-md bg-panel-2 border border-border text-dim">{r.kind === 'skill' ? `Master a skill · ${r.skill}` : PATHS.find(p => p[0] === r.path)?.[1] || r.pathOther || 'Custom path'}</span>
            <span className="px-2 py-1 rounded-md bg-panel-2 border border-border text-dim">{r.months} months · {r.hours} h/week</span>
            <span className="px-2 py-1 rounded-md bg-panel-2 border border-border text-dim tabular-nums">{s.done}/{s.total} steps</span>
          </div>
          {r.plan.reality && <p className="text-xs text-warning mt-3" dir="auto">{r.plan.reality}</p>}
        </div>
      </header>

      <Row side={0} top done={stageDone(stages[0]) || false} node={<Node on><Ico s={16} d={I.pin} /></Node>} aside={<span className="text-xs uppercase tracking-wider text-dim">Start</span>}>
        <div className="rounded-xl border border-dashed border-border p-4">
          <div className="text-[11px] uppercase tracking-wider text-accent font-semibold">You are here</div>
          <p className="text-sm text-gray-300 mt-1 line-clamp-4 whitespace-pre-line" dir="auto">{r.now}</p>
        </div>
      </Row>

      {stages.map((st, i) => {
        const n = st.steps.filter(t => done.has(t.id)).length, full = n === st.steps.length
        return (
          <Row key={i} side={(i + 1) % 2} done={full} node={<Node on={full}>{full ? <Ico s={16} d={I.check} /> : i + 1}</Node>}
            aside={<div><div className="text-3xl font-bold text-white/10 leading-none tabular-nums">{String(i + 1).padStart(2, '0')}</div><div className="text-xs text-dim mt-1">{st.duration}</div>{st.level && <div className="mt-2"><Level v={st.level} /></div>}</div>}>
            <div className={`rounded-xl border p-4 bg-panel transition-colors ${full ? 'border-accent/50' : 'border-border'}`}>
              <div className="flex items-center gap-2 text-[11px] text-dim"><span className="lg:hidden">{st.duration} ·</span><span className="uppercase tracking-wider">Stage {i + 1}</span>{st.level && <span className="lg:hidden"><Level v={st.level} /></span>}<span className="ms-auto tabular-nums">{n}/{st.steps.length}</span></div>
              <h2 className="text-base font-semibold text-white mt-1" dir="auto">{st.title}</h2>
              <p className="text-xs text-dim mt-0.5" dir="auto">{st.goal}</p>
              <div className="h-1 rounded-full bg-border overflow-hidden mt-3"><div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${n / st.steps.length * 100}%` }} /></div>
              {/* sub-steps hang off the stage like a branch: a thin line down the left, a dot per step */}
              <ul className="mt-3 flex flex-col border-s-2 border-border ms-2">
                {st.steps.map(t => { const on = done.has(t.id), show = openDetail === t.id; return (
                  <li key={t.id} className="relative ps-4 py-1">
                    <span className={`absolute -start-[5px] top-3 w-2 h-2 rounded-full ${on ? 'bg-accent' : 'bg-border'}`} />
                    <div className="flex items-start gap-2.5">
                      <button role="checkbox" aria-checked={on} aria-label={t.title} onClick={() => toggle(t.id)}
                        className={`mt-0.5 w-[18px] h-[18px] rounded-md flex-shrink-0 grid place-items-center border transition-colors ${on ? 'bg-accent border-accent text-app' : 'border-gray-500 hover:border-accent'}`}>{on && <Ico s={12} d={I.check} />}</button>
                      <button onClick={() => setOpenDetail(show ? null : t.id)} aria-expanded={show} title={show ? 'Hide how' : 'Show how'} className="group text-start flex-1 min-w-0">
                        <span className="flex items-start gap-1.5"><span className={`text-sm flex-1 ${on ? 'text-dim line-through' : 'text-white group-hover:text-accent'}`} dir="auto">{t.title}</span>
                          <span className={`mt-1 text-dim transition-transform ${show ? 'rotate-90' : ''}`}><Ico s={12} d={<path d="m9 18 6-6-6-6"/>} /></span></span>
                        {show && <span className="block text-xs text-gray-300 mt-1 leading-relaxed" dir="auto">{t.detail}</span>}
                      </button>
                    </div>
                  </li>) })}
              </ul>
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                <button onClick={() => interview(st, i)} disabled={asking !== null} title="A mock interview on this stage's topics"
                  className="btn-tint inline-flex items-center gap-1.5 text-xs disabled:opacity-50">{asking === i ? <span className="w-3 h-3 border-2 border-border border-t-accent rounded-full animate-spin" /> : <Ico s={12} d={I.mic} />}{asking === i ? 'Preparing the first question…' : 'Interview me'}</button>
                {ivErr?.i === i && <span className="text-[11px] text-error truncate">{ivErr.text}</span>}
              </div>
            </div>
          </Row>
        )
      })}

      <Row side={(stages.length + 1) % 2} bottom done={arrived} node={<Node on={arrived}><Ico s={16} d={I.flag} /></Node>} aside={<span className="text-xs uppercase tracking-wider text-dim">Finish</span>}>
        <div className={`rounded-xl border p-4 ${arrived ? 'border-accent bg-accent/10 shadow-accent-glow' : 'border-accent/40 bg-accent/5'}`}>
          <div className="text-[11px] uppercase tracking-wider text-accent font-semibold">{arrived ? 'You made it' : 'Destination'}</div>
          <p className="text-sm text-white font-medium mt-1 whitespace-pre-line line-clamp-4" dir="auto">{r.target}</p>
          {r.plan.finish && <p className="text-xs text-gray-300 mt-2" dir="auto">{r.plan.finish}</p>}
        </div>
      </Row>
    </div>
  )
}
