import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css'; // bundled by Vite → content-hashed, never stale-cached
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
