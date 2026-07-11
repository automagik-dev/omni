import { MainView } from '@omni/khal-ui-pack';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HarnessProviders } from './sdk-shim';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

// Dev-only deep-link: the pack uses a memory router (no URL bar coupling), so the
// harness lets you preselect a route via `?path=/chat` (or `#/chat`) — handy for
// QA screenshots and sharing a link to a specific screen.
function initialPathFromUrl(): string | undefined {
  const fromQuery = new URLSearchParams(window.location.search).get('path');
  if (fromQuery) return fromQuery.startsWith('/') ? fromQuery : `/${fromQuery}`;
  const hash = window.location.hash.replace(/^#/, '');
  return hash ? (hash.startsWith('/') ? hash : `/${hash}`) : undefined;
}

createRoot(root).render(
  <StrictMode>
    <HarnessProviders>
      <MainView windowId="harness" meta={{ initialPath: initialPathFromUrl() }} />
    </HarnessProviders>
  </StrictMode>,
);
