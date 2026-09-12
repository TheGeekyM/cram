import React, { useState, useEffect, useCallback, useRef } from 'react'

// A side panel you can drag by its inner edge to resize, or collapse to an icon rail.
// The handle sits inside the panel (absolutely positioned) so adding it never changes the
// surrounding flex layout or the gap between islands.
//
// `children` is a render prop receiving `collapsed`, so the panel's contents can swap to an
// icon-only form rather than being clipped.
export default function ResizableSidebar({
  storageKey,
  min = 180,
  max = 460,
  defaultWidth = 224,
  collapsedWidth = 56,
  className = '',
  children,
}) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey + ':w'))
    return saved >= min && saved <= max ? saved : defaultWidth
  })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey + ':c') === '1')
  const [dragging, setDragging] = useState(false)
  const lastDown = useRef(0)

  useEffect(() => { localStorage.setItem(storageKey + ':w', String(width)) }, [width, storageKey])
  useEffect(() => { localStorage.setItem(storageKey + ':c', collapsed ? '1' : '0') }, [collapsed, storageKey])

  const startDrag = useCallback((e) => {
    e.preventDefault()
    // Double-click is detected here rather than with onDoubleClick: the drag overlay below
    // mounts on the first mousedown, so the first mouseup lands on the sheet and not on this
    // handle — which means the browser never pairs the two clicks into a dblclick at all.
    if (e.timeStamp - lastDown.current < 350) {
      lastDown.current = 0
      setCollapsed(c => !c)
      return
    }
    lastDown.current = e.timeStamp
    const startX = e.clientX
    const startW = collapsed ? collapsedWidth : width
    const startedCollapsed = collapsed
    setDragging(true)
    const move = (ev) => {
      const next = startW + (ev.clientX - startX)
      // Pulling the rail back out. Without this the panel stays shut until the drag passes
      // the minimum width — 150px of nothing happening, which reads as a broken handle.
      if (startedCollapsed) {
        if (next > collapsedWidth + 12) {
          setCollapsed(false)
          setWidth(Math.max(min, Math.min(max, next)))
        } else {
          setCollapsed(true)
        }
        return
      }
      // Below the minimum, stop writing the width — otherwise a drag that ends in a collapse
      // first clamps the stored width down to `min`, and expanding again returns the panel at
      // its narrowest instead of the size the user had chosen.
      if (next < min) {
        // Dragging well past the minimum reads as "put it away", rather than sticking at min.
        // Restore the width the panel had when the drag began: getting there meant sweeping
        // through narrower valid widths, and those intermediate values are not a choice the
        // user made. Without this, expanding again returns the panel at its narrowest.
        if (next < min - 40) {
          setCollapsed(true)
          if (startW >= min) setWidth(startW)
        }
        return
      }
      setCollapsed(false)
      setWidth(Math.min(max, next))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }, [collapsed, collapsedWidth, width, min, max])

  return (
    <div
      style={{ width: collapsed ? collapsedWidth : width }}
      className={`relative flex-shrink-0 transition-[width] duration-150 ${className}`}
    >
      {typeof children === 'function' ? children(collapsed) : children}
      {/* An <iframe> eats the mouse: once the cursor crosses into one, this document stops
          seeing mousemove and the drag freezes where it stands. That is why the Documenter's
          sidebar could be collapsed but never pulled back out — the preview begins a few
          pixels to the right of the rail. A sheet over everything for the length of the drag
          keeps the pointer in this document, whatever is underneath. */}
      {dragging && <div className="fixed inset-0 z-[90] cursor-col-resize" />}
      <div
        onMouseDown={startDrag}
        title={collapsed ? 'Drag out, or double-click to expand' : 'Drag to resize, or double-click to collapse'}
        // The target reaches 4px past the panel into the gap between islands: a seam you
        // have to hit exactly is a seam that reads as broken, which is how this one read.
        className="group absolute top-0 -right-1 h-full w-2.5 cursor-col-resize"
      >
        <span className="absolute inset-y-0 right-1 w-1.5 rounded-full bg-transparent group-hover:bg-accent/50 group-active:bg-accent transition-colors" />
      </div>
    </div>
  )
}
