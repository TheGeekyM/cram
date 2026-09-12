import React from 'react'

// Same shape as aidle's NavBar, minus the license/updater cluster. ponytail: settings opens
// through a window event so any screen can trigger the one modal owned by App.
function NavBtn({ title, onClick, children }) {
  return (
    <button onClick={onClick} title={title}
      className="w-7 h-7 flex items-center justify-center rounded text-dim hover:text-white hover:bg-white/5 transition-colors flex-shrink-0">
      {children}
    </button>
  )
}
const Div = () => <div className="w-px h-4 bg-border mx-1" />

export default function NavBar({ title, project, onHome, onDashboard, right }) {
  return (
    <div className="h-10 titlebar-drag bg-panel border-b border-border flex items-center px-2 gap-1 flex-shrink-0">
      {onHome && (
        <NavBtn title="Home" onClick={onHome}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
        </NavBtn>
      )}
      {onDashboard && (
        <NavBtn title="Study" onClick={onDashboard}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
        </NavBtn>
      )}
      {(onHome || onDashboard) && <Div />}
      <div className="flex items-center gap-1.5 text-xs font-mono min-w-0">
        <div className="w-5 h-5 rounded-md grid place-items-center text-[11px] font-bold text-app flex-shrink-0" style={{ background: 'rgb(var(--c-accent))' }}>C</div>
        <span className="text-gray-300">cram</span>
        {project && <>
          <span className="text-gray-600">›</span>
          {onDashboard
            ? <button onClick={onDashboard} className="text-gray-300 hover:text-white truncate max-w-[220px]">{project.name}</button>
            : <span className="text-gray-300 truncate max-w-[220px]">{project.name}</span>}
        </>}
        {title && <><span className="text-gray-600">›</span><span className="text-gray-400 truncate">{title}</span></>}
      </div>
      <div className="flex-1" />
      {right && <><div className="flex items-center gap-1">{right}</div><Div /></>}
      <NavBtn title="Settings" onClick={() => window.dispatchEvent(new Event('cram:settings'))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </NavBtn>
    </div>
  )
}
