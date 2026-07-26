import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted webfonts (REVISION-PLAN.md §10.3) via @fontsource rather than
// a Google Fonts CDN link — matches this repo's no-external-runtime-
// dependency posture. Only the weights actually used by the app's
// font-normal/font-medium/font-semibold/font-bold utility classes.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
