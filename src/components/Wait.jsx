import React, { useState, useEffect } from 'react'
// Spinner + label + live elapsed seconds, so a long generation visibly keeps going.
export default function Wait({ label }) {
  const [s, setS] = useState(0)
  useEffect(() => { const t = setInterval(() => setS(x => x + 1), 1000); return () => clearInterval(t) }, [])
  const hint = s < 3 ? 'Starting Claude…' : s < 25 ? label : 'Still writing, longer ones take a while…'
  return <><span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin" />{hint}<span className="font-mono text-xs opacity-70 tabular-nums">{s}s</span></>
}
