import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevención de excepciones en entornos iframe (donde window.alert/confirm están bloqueados por políticas del navegador)
if (typeof window !== 'undefined') {
  window.alert = (message?: any) => {
    console.warn('[Alerta en app]:', message);
    window.dispatchEvent(new CustomEvent('app-global-notification', { detail: String(message ?? '') }));
  };
  window.confirm = (message?: any) => {
    console.warn('[Confirmación en app]:', message);
    return true;
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
