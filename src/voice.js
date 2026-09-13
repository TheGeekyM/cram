import { useState, useRef, useCallback, useEffect } from 'react'

// Voice for the interview: the interviewer speaks (Edge neural voices via /api/speak) and the learner answers by mic
// (Silero VAD finds where speech starts and stops, /api/transcribe turns each utterance into text with local Whisper).

// direction of a mixed text: Arabic wins when it has more Arabic letters than Latin ones ("ما هو Big O؟" is RTL)
export const isRtl = t => { const s = String(t || ''); return (s.match(/[؀-ۿ]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length }
export const dirOf = t => isRtl(t) ? 'rtl' : 'ltr'

// one shared player; `token` drops audio that arrives after a newer request or a stop
const player = new Audio(); let token = 0
// 0..1 through the current clip; `estimate` (seconds) stands in while an MP3's duration is still unknown or Infinity
export const speechProgress = estimate => { const d = player.duration; return player.currentTime / (Number.isFinite(d) && d > 0 ? d : estimate) }
export function stopSpeech() { token++; player.pause(); fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stop":true}' }).catch(() => {}) }
// Resolves when speaking is over: 'played' | 'stopped' | 'fallback' (espeak, no audio to follow) | 'failed'. onStart fires when sound begins.
export async function speak(text, lang, onStart) {
  const my = ++token; player.pause()
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) })
    if (my !== token) return 'stopped'
    if (!r.headers.get('content-type')?.startsWith('audio/')) return r.ok ? 'fallback' : 'failed'
    const blob = await r.blob(); if (my !== token) return 'stopped'
    URL.revokeObjectURL(player.src); player.src = URL.createObjectURL(blob)
    await player.play(); onStart?.()
    return await new Promise(res => {
      const done = v => { player.removeEventListener('ended', ended); player.removeEventListener('pause', paused); res(v) }
      const ended = () => done('played'), paused = () => done(my === token && player.ended ? 'played' : 'stopped')
      player.addEventListener('ended', ended); player.addEventListener('pause', paused)
    })
  } catch (e) { if (e.name !== 'AbortError') console.warn('read aloud failed', e); return my === token ? 'failed' : 'stopped' }
}

// Mic with voice activity detection. state: off | loading | listening | speaking | transcribing
// onText gets each utterance's text; onSpeechStart fires as soon as the learner starts talking.
export function useMic({ lang, onText, onSpeechStart, onError }) {
  const [state, setState] = useState('off')
  const vad = useRef(null), active = useRef(false), cb = useRef()
  cb.current = { lang, onText, onSpeechStart, onError }
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
        onVADMisfire: idle,
        onSpeechEnd: async audio => {
          setState('transcribing')
          const body = utils.encodeWAV(audio, 1, 16000, 1, 16)
          const r = await fetch(`/api/transcribe?lang=${/arab/i.test(cb.current.lang) ? 'ar' : 'en'}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body })
            .then(x => x.json()).catch(e => ({ error: e.message }))
          idle()
          if (r.error) cb.current.onError?.(r.error); else if (r.text) cb.current.onText(r.text)
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
