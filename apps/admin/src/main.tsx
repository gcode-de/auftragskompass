import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito-sans';
import './styles.css';
import { App } from './App.js';
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
