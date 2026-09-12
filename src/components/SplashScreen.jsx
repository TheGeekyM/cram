import React, { useEffect, useState } from 'react'

// Cold-start animation. Aidle's line is "study smarter, not longer", so the mark is lit
// rather than merely drawn: the tile lands, a sweep of light crosses it, the wordmark and
// tagline rise, then the whole thing lifts away and the app is already behind it.
//
// Kept to ~1.5s and mounted over a live app — nothing waits on it. Anyone who has asked the
// OS for less motion skips straight through.
const TOTAL = 1500
const FADE_AT = 1150

export default function SplashScreen({ onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onDone(); return }

    // Timed off animation frames, not the wall clock. A window that starts minimised or
    // occluded — which is how this app often comes up under GNOME — paints nothing, and
    // Chromium pauses CSS animations with it while setTimeout keeps counting. On a wall
    // clock the splash would retire on schedule having never drawn a single frame, so you
    // restore the window to an app that already swallowed its own intro. rAF only ticks
    // when frames are actually produced, which is the same clock the animation runs on.
    let raf = 0
    let start = null
    const step = (now) => {
      if (start === null) start = now
      const elapsed = now - start
      if (elapsed >= FADE_AT) setLeaving(true)
      if (elapsed >= TOTAL) { onDone(); return }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [onDone])

  return (
    <div className={`splash ${leaving ? 'splash-leaving' : ''}`} aria-hidden="true">
      <div className="splash-glow" />
      <div className="splash-stack">
        <div className="splash-mark">
          <span>C</span>
          <i className="splash-sweep" />
        </div>
        <div className="splash-word">cram</div>
        <div className="splash-tag">study smarter, not longer</div>
      </div>
    </div>
  )
}
