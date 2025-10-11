import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <div style={{display:'grid',placeItems:'center',height:'100dvh',fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'}}>
      <div>
        <h1 style={{margin:0}}>Hello from React + Vite</h1>
        <p style={{opacity:.8}}>Home is now the React app. Upload page moved to <a href="/uploads">/uploads</a>.</p>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)

