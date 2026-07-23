import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css'; // bundled by Vite → content-hashed, never stale-cached
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: register the service worker in production builds only (it would fight
// Vite's dev server otherwise).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
