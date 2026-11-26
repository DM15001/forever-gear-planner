import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// The Dev copy can try a look the Live site does not have yet: styles ask for this mark.
if (import.meta.env.VITE_CHANNEL === 'dev') document.documentElement.dataset.channel = 'dev';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
