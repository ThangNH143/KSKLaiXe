import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { resolveRouterBasename } from './api/http';
import { App } from './App';
import './App.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Không tìm thấy phần tử #root');
}

const routerBasename = resolveRouterBasename();

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter {...(routerBasename ? { basename: routerBasename } : {})}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
