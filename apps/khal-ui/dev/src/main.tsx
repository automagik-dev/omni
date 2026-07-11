import { MainView } from '@omni/khal-ui-pack';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HarnessProviders } from './sdk-shim';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <HarnessProviders>
      <MainView windowId="harness" />
    </HarnessProviders>
  </StrictMode>,
);
