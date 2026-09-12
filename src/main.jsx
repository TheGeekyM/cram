import React, { useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './api.js'
import App from './App.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import './index.css'
import { initTheme } from './theme.js'

class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-white font-semibold">Something went wrong rendering this screen.</p>
        <pre className="text-xs text-error max-w-2xl overflow-auto whitespace-pre-wrap">{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={() => this.setState({ error: null })} className="text-xs px-3 py-1.5 rounded bg-accent text-app">↻ Reload UI</button>
      </div>
    )
  }
}
function Root() {
  const [booting, setBooting] = useState(true)
  const done = useCallback(() => setBooting(false), [])
  return <><App />{booting && <SplashScreen onDone={done} />}</>
}
initTheme()
createRoot(document.getElementById('root')).render(<ErrorBoundary><Root /></ErrorBoundary>)
