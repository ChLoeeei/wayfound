import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (process.env.AMAP_SECURITY_CODE) {
  // @ts-ignore
  window._AMapSecurityConfig = {
    securityJsCode: process.env.AMAP_SECURITY_CODE,
  };
}

// Suppress cross-origin Script Errors from AMap due to domain mismatches
const originalOnError = window.onerror;
window.onerror = function (msg, url, lineNo, columnNo, error) {
  if (msg === 'Script error.' || msg === 'Script error') {
    console.warn('Ignored cross-origin script error from AMap.');
    return true; // return true suppresses the error
  }
  if (originalOnError) {
    // @ts-ignore
    return originalOnError(msg, url, lineNo, columnNo, error);
  }
  return false;
};
window.addEventListener('error', (e) => {
  if (e.message === 'Script error.' || e.message === 'Script error') {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true); // use capture phase to catch before Vite overlay

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
