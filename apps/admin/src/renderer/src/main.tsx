import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StudioLocaleProvider } from './i18n';
import './styles.css';
import './splash.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
root.addEventListener('dragstart', (event) => event.preventDefault(), true);

createRoot(root).render(
  <StrictMode>
    <StudioLocaleProvider>
      <App />
    </StudioLocaleProvider>
  </StrictMode>,
);
