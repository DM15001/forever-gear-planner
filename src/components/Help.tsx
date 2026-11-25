import type { ReactNode } from 'react';

/** A small question mark: the explanation shows on hover or focus, so it takes no room until somebody wants it. */
export function Help({ label, children }: { label: string; children: ReactNode }) {
	return (
		<span className="powered-by help" tabIndex={0} aria-label={label}>
			<span className="powered-mark" aria-hidden="true">
				?
			</span>
			<span className="powered-pop" role="tooltip">
				{children}
			</span>
		</span>
	);
}
