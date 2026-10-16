import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { STANDALONE } from './api';
import App from './App';
import { AppProvider } from './context';
import './styles.css';

// The standalone page lives at a fixed URL inside a viewer frame, so it keeps navigation in memory.
const Router = STANDALONE ? MemoryRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <AppProvider>
        <App />
      </AppProvider>
    </Router>
  </React.StrictMode>,
);
