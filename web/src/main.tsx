import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme.tsx'
import IconSprite from './IconSprite.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconSprite />
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
