import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted webfonts via @fontsource rather than a Google Fonts CDN link —
// matches this repo's no-external-runtime-dependency posture. "Field Ledger"
// visual direction (the default "ember" theme, and crimson/amber): Bitter
// (display/headings), IBM Plex Sans (body/UI). IBM Plex Mono is used for
// every number in the app — HP, AC, initiative, dice, ability scores —
// monospace digits align in columns and read unambiguously (a legibility
// choice, not decoration) — and stays the same across every theme, including
// Arcane Console below. Space Grotesk is Arcane Console's own display/body
// face, loaded here but only applied via that theme's `--font-display`/
// `--font-sans` override in index.css — this is the first theme where
// typography is part of the swap, not just color.
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
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
