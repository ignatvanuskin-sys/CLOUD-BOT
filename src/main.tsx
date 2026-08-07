import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import App from './app/App';import {AppProviders} from './providers/AppProviders';import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AppProviders><App/></AppProviders></BrowserRouter></React.StrictMode>);
