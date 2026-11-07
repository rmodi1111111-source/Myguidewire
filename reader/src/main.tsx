import { createRoot } from 'react-dom/client';
import '@fontsource-variable/literata';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App';
import { initPlatform } from './lib/platform';

initPlatform();
createRoot(document.getElementById('root')!).render(<App />);

// Offline support when installed as a web app (Windows / desktop / iPhone home screen).
if ('serviceWorker' in navigator && location.protocol === 'https:' && !(window as any).Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
