import { useState, useRef, useCallback, useEffect } from 'react'

// Voice for the interview: the interviewer speaks (Edge neural voices via /api/speak) and the learner answers by mic
// (Silero VAD finds where speech starts and stops, /api/transcribe turns each utterance into text with local Whisper).

// direction of a mixed text: any Arabic makes it RTL. A technical Arabic line ("لو 5000 request جم بعد الـ TTL")
// can hold more Latin letters than Arabic ones, and dir="auto" only reads the first letter.
export const isRtl = t => /[؀-ۿ]/.test(String(t || ''))
export const dirOf = t => isRtl(t) ? 'rtl' : 'ltr'

// one shared player; `token` drops audio that arrives after a newer request or a stop
const player = new Audio(); let token = 0, prog = { done: 0, cur: 0, total: 1 }
// 0..1 through the whole text being spoken: chars of the finished sentences plus the share of the current clip.
// `estimate` (seconds, for the whole text) stands in, pro rata, while an MP3's duration is still unknown or Infinity
export const speechProgress = estimate => { const d = player.duration, { done, cur, total } = prog; return (done + cur * (Math.min(1, player.currentTime / (Number.isFinite(d) && d > 0 ? d : estimate * cur / total)) || 0)) / total }
export function stopSpeech() { token++; player.pause(); fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stop":true}' }).catch(() => {}) }
// sentences to speak one by one: split after . ? ! ؟ and at newlines; a bit under 25 chars joins its neighbour so no request is tiny
export const sentences = t => String(t || '').split(/(?<=[.?!؟])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  .reduce((a, s) => (a.length && (a[a.length - 1].length < 25 || s.length < 25) ? a[a.length - 1] += ' ' + s : a.push(s), a), [])
// the audio of one sentence, or 'fallback' (espeak is reading it) | 'failed'
const fetchClip = (text, lang) => fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) })
  .then(r => r.headers.get('content-type')?.startsWith('audio/') ? r.blob() : r.ok ? 'fallback' : 'failed').catch(e => (console.warn('read aloud failed', e), 'failed'))
const clipEnd = my => new Promise(res => {
  const done = v => { player.removeEventListener('ended', ended); player.removeEventListener('pause', paused); res(v) }
  const ended = () => done('played'), paused = () => done(my === token && player.ended ? 'played' : 'stopped')
  player.addEventListener('ended', ended); player.addEventListener('pause', paused)
})
// Resolves when speaking is over: 'played' | 'stopped' | 'fallback' (espeak, no audio to follow) | 'failed'. onStart fires when sound begins.
// Sentence by sentence, so sound starts after the first one is ready; the next is fetched while one plays (not sooner: each
// request cancels espeak, which would cut off a fallback). Any Arabic keeps every sentence in the Arabic voice, as the whole text had.
export async function speak(text, lang, onStart) {
  const my = ++token; player.pause()
  const parts = sentences(text), l = isRtl(text) ? 'Arabic' : lang; if (!parts.length) parts.push('')
  prog = { done: 0, cur: 0, total: parts.reduce((n, s) => n + s.length, 0) || 1 }
  try {
    let next = fetchClip(parts[0], l)
    for (let i = 0; i < parts.length; i++) {
      const clip = await next; if (my !== token) return 'stopped'
      // no audio for the first sentence: let espeak read it all; a later sentence failing ends it there
      if (typeof clip === 'string') { if (!i && clip === 'fallback' && parts.length > 1) fetchClip(text, l); return i ? 'failed' : clip }
      next = i + 1 < parts.length && fetchClip(parts[i + 1], l)
      URL.revokeObjectURL(player.src); player.src = URL.createObjectURL(clip); prog.cur = parts[i].length
      await player.play(); if (!i) onStart?.()
      const r = await clipEnd(my); if (r !== 'played') return r
      prog.done += parts[i].length; prog.cur = 0
    }
    return 'played'
  } catch (e) { if (e.name !== 'AbortError') console.warn('read aloud failed', e); return my === token ? 'failed' : 'stopped' }
}

// Mic with voice activity detection. state: off | loading | listening | speaking | transcribing
// onText(text, { secs, endAt }) gets each utterance with how long it was spoken; onSpeechStart fires as soon as sound starts,
// onSpeechRealStart once it has lasted long enough to be real speech (safe for interrupting the interviewer).
export function useMic({ lang, onText, onSpeechStart, onSpeechRealStart, onError }) {
  const [state, setState] = useState('off')
  const vad = useRef(null), active = useRef(false), cb = useRef()
  cb.current = { lang, onText, onSpeechStart, onSpeechRealStart, onError }
  const idle = () => setState(active.current ? 'listening' : 'off')
  const start = useCallback(async () => {
    active.current = true
    if (vad.current) { await vad.current.start(); return setState('listening') }
    setState('loading')
    try {
      const status = await fetch('/api/transcribe').then(r => r.json())
      if (!status.available) throw new Error('Speech recognition is not installed on this computer.')
      const { MicVAD, utils } = await import('@ricky0123/vad-web')
      vad.current = await MicVAD.new({
        model: 'v5', baseAssetPath: '/vad/', onnxWASMBasePath: '/vad/', startOnLoad: false,
        redemptionMs: 900, minSpeechMs: 250, preSpeechPadMs: 400, // a short pause closes one utterance; the caller decides when the answer is over
        onSpeechStart: () => { setState('speaking'); cb.current.onSpeechStart?.() },
        onSpeechRealStart: () => cb.current.onSpeechRealStart?.(),
        onVADMisfire: idle,
        onSpeechEnd: async audio => {
          const info = { secs: audio.length / 16000, endAt: Date.now() }
          setState('transcribing')
          const body = utils.encodeWAV(audio, 1, 16000, 1, 16)
          const r = await fetch(`/api/transcribe?lang=${cb.current.lang === 'auto' ? 'auto' : /arab/i.test(cb.current.lang) ? 'ar' : 'en'}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body })
            .then(x => x.json()).catch(e => ({ error: e.message }))
          idle()
          if (r.error) cb.current.onError?.(r.error); else if (r.text) cb.current.onText(r.text, info)
        },
      })
      if (!active.current) return setState('off') // switched off while loading
      await vad.current.start(); setState('listening')
    } catch (e) {
      active.current = false; setState('off')
      cb.current.onError?.(/permission|denied|notallowed/i.test(e.message + e.name) ? 'Microphone access was denied.' : e.message)
    }
  }, []) // eslint-disable-line
  const stop = useCallback(() => { active.current = false; vad.current?.pause(); setState(s => s === 'transcribing' ? s : 'off') }, [])
  useEffect(() => () => { active.current = false; vad.current?.destroy() }, [])
  return { state, start, stop, on: state !== 'off' }
}
