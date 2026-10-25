import { ReactNode } from 'react';
import { FileState } from '../shared/protocol';

export function Badge({ state }: { state: FileState }) {
	return <span className={`badge badge-${state}`} title={STATE_LABEL[state]}>{state}</span>;
}

const STATE_LABEL: Record<FileState, string> = {
	A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Conflict',
};

export function IconButton(props: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
	return (
		<button className="icon-btn" title={props.title} aria-label={props.title} disabled={props.disabled}
			onClick={e => { e.stopPropagation(); props.onClick(); }}>
			{props.children}
		</button>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return <div className="empty">{children}</div>;
}

export function Section(props: { title: string; count?: number; actions?: ReactNode; children: ReactNode; tone?: 'danger' }) {
	return (
		<section className={`section${props.tone ? ` section-${props.tone}` : ''}`}>
			<header className="section-header">
				<span className="section-title">{props.title}</span>
				{props.count !== undefined && <span className="count">{props.count}</span>}
				<span className="spacer" />
				{props.actions}
			</header>
			{props.children}
		</section>
	);
}

export function shortSig(signature: string): string {
	return signature.slice(0, 8);
}

export function fileName(path: string): { name: string; dir: string } {
	const i = path.lastIndexOf('/');
	return i < 0 ? { name: path, dir: '' } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

export function timeAgo(date: string): string {
	const t = Date.parse(date);
	if (!t) {
		return date;
	}
	const s = Math.max(0, (Date.now() - t) / 1000);
	if (s < 60) { return 'just now'; }
	if (s < 3600) { return `${Math.floor(s / 60)}m ago`; }
	if (s < 86400) { return `${Math.floor(s / 3600)}h ago`; }
	if (s < 86400 * 30) { return `${Math.floor(s / 86400)}d ago`; }
	return new Date(t).toLocaleDateString();
}
