import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted webfonts via @fontsource rather than a Google Fonts CDN link —
// matches this repo's no-external-runtime-dependency posture. "Field Ledger"
// visual direction: Bitter (display/headings), IBM Plex Sans (body/UI), IBM
// Plex Mono (every number in the app — HP, AC, initiative, dice, ability
// scores — monospace digits align in columns and read unambiguously, a
// legibility choice, not decoration). Replaces the earlier Fraunces/Inter
// pairing app-wide, across every color theme (typography was never part of
// the theme-swap system — only colors were).
import '@fontsource/bitter/500.css'
import '@fontsource/bitter/600.css'
import '@fontsource/bitter/700.css'
import '@fontsource/bitter/800.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
