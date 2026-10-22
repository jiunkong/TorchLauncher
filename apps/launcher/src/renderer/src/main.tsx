import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LauncherLocaleProvider } from './i18n';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(
  <StrictMode>
    <LauncherLocaleProvider>
      <App />
    </LauncherLocaleProvider>
  </StrictMode>,
);
