import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/lora'
import './styles.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
