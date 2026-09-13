import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'

// Silero VAD (mic answers) loads its model, audio worklet and ONNX wasm by URL at runtime, so they ship as plain files in dist/vad
const VAD_FILES = [
  ['@ricky0123/vad-web/dist/silero_vad_v5.onnx'], ['@ricky0123/vad-web/dist/vad.worklet.bundle.min.js'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'], ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'],
]
const vadAssets = {
  name: 'vad-assets',
  closeBundle() {
    mkdirSync('dist/vad', { recursive: true })
    for (const [f] of VAD_FILES) cpSync(`node_modules/${f}`, `dist/vad/${f.split('/').pop()}`)
  },
}
export default defineConfig({ root: 'src', base: './', plugins: [react(), vadAssets], build: { outDir: '../dist', emptyOutDir: true } })
