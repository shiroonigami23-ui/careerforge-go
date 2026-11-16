import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fade out the HTML boot splash from index.html (it enforces a 2 s minimum itself).
requestAnimationFrame(() => window.__cfHideSplash?.())
