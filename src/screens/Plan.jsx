import React, { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'

// Plan board: a backlog plus Monday→Sunday columns. Items are dragged onto days; the whole list is
// saved on every change (POST /api/plan replaces it). Dates are local YYYY-MM-DD, never UTC.
const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const I = {
  ask: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  quiz: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  interview: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>,
  code: <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>,
  review: <><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></>,
  notes: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></>,
  check: <path d="M20 6 9 17l-5-5"/>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></>,
  left: <path d="m15 18-6-6 6-6"/>, right: <path d="m9 18 6-6-6-6"/>,
}
const TOOLS = [['', 'No tool'], ['ask', 'Ask'], ['interview', 'Interview'], ['code', 'Code'], ['review', 'Review'], ['notes', 'Notes']]
const TOOL_IDS = TOOLS.map(t => t[0])
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)) }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const MONTH = (d, year) => d.toLocaleDateString(undefined, { month: 'short', ...(year ? { year: 'numeric' } : {}) })
const weekLabel = mon => { const sun = addDays(mon, 6); return mon.getMonth() === sun.getMonth() ? `${mon.getDate()} – ${sun.getDate()} ${MONTH(sun, true)}` : `${mon.getDate()} ${MONTH(mon, mon.getFullYear() !== sun.getFullYear())} – ${sun.getDate()} ${MONTH(sun, true)}` }

function Card({ it, study, onToggle, onDelete, onOpen, onDragStart, onDragEnd, dragging }) {
  return (
    <div draggable onDragStart={e => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(it.id) }} onDragEnd={onDragEnd}
      className={`group relative rounded-lg bg-app border border-border px-2.5 py-2 flex gap-2 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-colors ${dragging ? 'opacity-40' : ''} ${it.done ? 'opacity-60' : ''}`}>
      <button onClick={onToggle} title={it.done ? 'Mark not done' : 'Mark done'} className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 grid place-items-center ${it.done ? 'bg-success border-success text-app' : 'border-border hover:border-accent'}`}>{it.done && <Ico s={10} d={I.check} />}</button>
      <div className="min-w-0 flex-1 pr-4">
        <div dir="auto" className={`text-xs leading-snug break-words ${it.done ? 'line-through text-dim' : 'text-gray-100'}`}>{it.text}</div>
        {study && <div className="text-[10px] text-dim truncate mt-0.5">{study}</div>}
      </div>
      {it.tool && <button onClick={onOpen} title={`Open ${TOOLS.find(t => t[0] === it.tool)?.[1]}`} className="self-start w-6 h-6 rounded-md bg-accent/15 text-accent grid place-items-center flex-shrink-0 hover:bg-accent hover:text-app transition-colors"><Ico s={12} d={I[it.tool]} /></button>}
      <button onClick={onDelete} title="Delete" className="absolute top-1 right-1 w-5 h-5 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-error hover:bg-white/5 grid place-items-center"><Ico s={11} d={I.trash} /></button>
    </div>
  )
}

export default function Plan({ studies = [], onOpenTool }) {
  const [items, setItems] = useState([]); const [coach, setCoach] = useState([]); const [profile, setProfile] = useState({}); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState('')
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [drag, setDrag] = useState(null); const [over, setOver] = useState(null) // over = 'backlog' | 'YYYY-MM-DD'
  const [text, setText] = useState(''); const [sid, setSid] = useState(''); const [tool, setTool] = useState('')
  const [adding, setAdding] = useState(null); const [dayText, setDayText] = useState('') // inline add inside one day column

  useEffect(() => {
    Promise.all([api.get('/api/plan'), api.get('/api/profile')]).then(([p, pr]) => {
      if (p.error) setErr(p.error); else { setItems(p.items || []); setCoach(p.coach || []) }
      if (!pr.error) setProfile(pr); setLoaded(true)
    })
  }, [])
  const save = next => { setItems(next); api.post('/api/plan', { items: next }).then(r => setErr(r.error || '')) }
  const titleOf = id => studies.find(s => s.id === id)?.title
  const add = (t, day = null, extra = {}) => { const v = t.trim(); if (v) save([...items, { id: uid(), text: v, tool: '', studyId: null, day, done: false, ...extra }]) }
  const addBacklog = () => { if (!text.trim()) return; add(text, null, { tool, studyId: sid || null }); setText('') }
  const move = (id, day) => save(items.map(x => x.id === id ? { ...x, day } : x))
  const fresh = coach.filter(c => c.text && !items.some(x => x.text.trim().toLowerCase() === c.text.trim().toLowerCase()))
  const importCoach = () => save([...items, ...fresh.map(c => ({ id: uid(), text: c.text, tool: TOOL_IDS.includes(c.tool) ? c.tool : '', studyId: c.studyId && studies.some(s => s.id === c.studyId) ? c.studyId : null, day: null, done: false }))])

  const today = ymd(new Date())
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(addDays(week, i))), [week])
  const examDays = profile.examDate ? Math.round((parse(profile.examDate) - parse(today)) / 864e5) : null
  const zone = key => ({
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key) },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => o === key ? null : o) },
    onDrop: e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || drag; if (id) move(id, key === 'backlog' ? null : key); setOver(null); setDrag(null) },
  })
  const card = it => <Card key={it.id} it={it} study={titleOf(it.studyId)} dragging={drag === it.id} onDragStart={setDrag} onDragEnd={() => { setDrag(null); setOver(null) }}
    onToggle={() => save(items.map(x => x.id === it.id ? { ...x, done: !x.done } : x))} onDelete={() => save(items.filter(x => x.id !== it.id))} onOpen={() => onOpenTool?.(it.studyId, it.tool)} />
  const backlog = items.filter(x => !x.day)
  const empty = loaded && !items.length && !coach.length

  return (
    <div className="h-full flex flex-col gap-2.5 p-2.5 min-h-0">
      <div className="island px-4 py-3 flex items-center gap-3 flex-wrap flex-shrink-0">
        <div><div className="text-lg font-semibold text-white leading-tight">Plan</div><div className="text-xs text-dim">{weekLabel(week)}</div></div>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setWeek(w => addDays(w, -7))} className="w-8 h-8 rounded-lg border border-border text-dim hover:text-white hover:bg-white/5 grid place-items-center" title="Previous week"><Ico d={I.left} /></button>
          <button onClick={() => setWeek(mondayOf(new Date()))} className="btn-tint">Today</button>
          <button onClick={() => setWeek(w => addDays(w, 7))} className="w-8 h-8 rounded-lg border border-border text-dim hover:text-white hover:bg-white/5 grid place-items-center" title="Next week"><Ico d={I.right} /></button>
        </div>
        {examDays != null && <button onClick={() => setWeek(mondayOf(parse(profile.examDate)))} title="Jump to the exam week" className={`badge gap-1.5 py-1 ${examDays < 0 ? '' : examDays <= 14 ? 'badge-red' : 'badge-yellow'}`}><Ico s={12} d={I.flag} />{profile.examName ? `${profile.examName} · ` : ''}{examDays > 1 ? `Exam in ${examDays} days` : examDays === 1 ? 'Exam tomorrow' : examDays === 0 ? 'Exam today' : 'Exam passed'}</button>}
        <div className="flex-1" />
        {err && <span className="text-xs text-error">{err}</span>}
        <span className="text-xs text-dim">{items.filter(x => x.done).length}/{items.length} done</span>
        <button onClick={importCoach} disabled={!fresh.length} title={coach.length ? (fresh.length ? `Add ${fresh.length} coach to-do${fresh.length === 1 ? '' : 's'} to the backlog` : 'All coach to-dos are already on the board') : 'Open the Dashboard once so the coach can build your list'}
          className="btn btn-primary text-xs py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Ico s={13} d={I.plus} />Import coach to-dos{fresh.length ? ` (${fresh.length})` : ''}</button>
      </div>
      {!coach.length && loaded && !empty && <div className="text-[11px] text-dim px-1 -mt-1">Open the Dashboard once so the coach can build your list.</div>}

      <div className="flex-1 min-h-0 flex gap-2.5">
        <div {...zone('backlog')} className={`island w-64 flex-shrink-0 flex flex-col min-h-0 transition-colors ${over === 'backlog' ? 'border-accent bg-accent/5' : ''}`}>
          <div className="px-3 pt-3 pb-2 flex items-center gap-2"><span className="text-sm font-semibold text-white">Unscheduled</span><span className="badge py-0">{backlog.length}</span></div>
          <div className="px-3 pb-2 flex flex-col gap-1.5 border-b border-border">
            <input dir="auto" className="input py-1.5 text-xs" placeholder="Add a to-do… (Enter)" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBacklog()} />
            <div className="flex gap-1.5">
              <select className="input py-1 text-[11px] flex-1 min-w-0" value={sid} onChange={e => setSid(e.target.value)}><option value="">No study</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
              <select className="input py-1 text-[11px] w-24" value={tool} onChange={e => setTool(e.target.value)}>{TOOLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
            {backlog.map(card)}
            {!backlog.length && <div className="text-[11px] text-dim text-center py-6 px-2">{items.length ? 'Everything is scheduled. Drag a card here to unschedule it.' : 'Add to-dos here, then drag them onto a day.'}</div>}
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-x-auto relative">
          <div className="grid grid-cols-7 gap-2 h-full" style={{ minWidth: 7 * 104 }}>
            {days.map(day => {
              const list = items.filter(x => x.day === day), done = list.filter(x => x.done).length, d = parse(day)
              const isToday = day === today, past = day < today, exam = day === profile.examDate
              return (
                <div key={day} {...zone(day)} className={`island flex flex-col min-h-0 transition-colors ${over === day ? 'border-accent bg-accent/5' : isToday ? 'border-accent/60' : exam ? 'border-error/50' : ''} ${past && over !== day ? 'opacity-60' : ''}`}>
                  <div className={`px-2.5 pt-2.5 pb-2 flex items-center gap-1.5 border-b ${isToday ? 'border-accent/40' : 'border-border'}`}>
                    <div className="leading-tight min-w-0">
                      <div className={`text-[10px] uppercase tracking-wider ${isToday ? 'text-accent font-semibold' : 'text-dim'}`}>{d.toLocaleDateString(undefined, { weekday: 'short' })}{isToday ? ' · today' : ''}</div>
                      <div className={`text-lg font-semibold font-mono ${isToday ? 'text-accent' : 'text-white'}`}>{d.getDate()}</div>
                    </div>
                    {exam && <span className="badge badge-red py-0 gap-1 ml-1" title={profile.examName || 'Exam'}><Ico s={10} d={I.flag} />Exam</span>}
                    <button onClick={() => { setAdding(day); setDayText('') }} className="ml-auto w-6 h-6 rounded-md text-dim hover:text-accent hover:bg-accent/10 grid place-items-center" title="Add to this day"><Ico s={13} d={I.plus} /></button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
                    {adding === day && <input autoFocus dir="auto" className="input py-1.5 text-xs" placeholder="New to-do… (Enter)" value={dayText} onChange={e => setDayText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.currentTarget.dataset.done = '1'; if (e.key === 'Enter') add(dayText, day); setAdding(null) } }}
                      onBlur={e => { if (e.currentTarget.dataset.done) return; add(dayText, day); setAdding(null) }} /* ponytail: dataset flag stops the unmount blur from adding twice */ />}
                    {list.map(card)}
                    {!list.length && adding !== day && over === day && <div className="text-[11px] text-accent text-center py-3">Drop here</div>}
                  </div>
                  <div className="px-2.5 py-1.5 border-t border-border text-[10px] text-dim flex items-center gap-1.5">
                    <span className="font-mono">{done}/{list.length} done</span>
                    {list.length > 0 && <div className="flex-1 h-1 rounded-full bg-panel-2 overflow-hidden"><div className="h-full bg-success rounded-full" style={{ width: `${done / list.length * 100}%` }} /></div>}
                  </div>
                </div>
              )
            })}
          </div>
          {empty && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="island px-8 py-6 text-center max-w-sm shadow-accent-glow">
                <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent grid place-items-center mx-auto mb-3"><Ico s={22} d={<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></>} /></div>
                <div className="text-sm font-semibold text-white">Your week is wide open</div>
                <div className="text-xs text-dim mt-1">Add a to-do on the left and drag it onto a day, or open the Dashboard so the coach can suggest what to study, then import its list here.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
