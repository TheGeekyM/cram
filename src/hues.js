// The app's tile hues — the gradient pairs behind the dashboard's pipeline strip and the
// homepage's project cards. One list, so those two surfaces stay recognisably the same family.
export const TILE_HUES = [
  ['#6d4ce8', '#9b5cf0'],   // violet
  ['#3b82f6', '#6366f1'],   // blue
  ['#f59e0b', '#f97316'],   // amber
  ['#ec4899', '#d946ef'],   // pink
  ['#06b6d4', '#3b82f6'],   // cyan
  ['#10b981', '#06b6d4'],   // green
]

export const hueFor = (i) => TILE_HUES[Math.abs(i) % TILE_HUES.length]
export const gradient = ([a, b]) => `linear-gradient(135deg, ${a}, ${b})`
