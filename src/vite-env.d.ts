/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Set to build a copy without the simulator. */
	readonly VITE_NO_SIM?: string;
}

/** The WoWSims commit of the simulator files this build ships (vite.config.ts). */
declare const __SIM_COMMIT__: string;
