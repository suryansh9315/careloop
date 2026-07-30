import React from 'react';
import ReactDOM from 'react-dom/client';
import { MedplumProvider } from '@medplum/react-hooks';
import { App } from './App';
import { medplum } from './medplum';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MedplumProvider medplum={medplum}>
      <App />
    </MedplumProvider>
  </React.StrictMode>,
);
