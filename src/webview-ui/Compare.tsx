import { useEffect, useRef, useState } from 'react';
import { CompareResult, Message } from '../shared/protocol';
import { Badge, Empty, fileName } from './common';
import { send } from './vscode';

let nextRequestId = 1;

/** Asks the host to diff two branches and returns the result; re-runs whenever the inputs change. */
export function useCompare(source: string, target: string, revision: unknown) {
	const [state, setState] = useState<{ loading: boolean; result?: CompareResult; error?: string }>({ loading: false });
	const latest = useRef(0);

	useEffect(() => {
		if (!source || !target || source === target) {
			setState({ loading: false });
			return;
		}
		const requestId = nextRequestId++;
		latest.current = requestId;
		setState(s => ({ ...s, loading: true, error: undefined }));
		const onMessage = (event: MessageEvent<Message>) => {
			const m = event.data;
			if (m.type === 'compare' && m.requestId === requestId && latest.current === requestId) {
				setState({ loading: false, result: m.result, error: m.error });
			}
		};
		window.addEventListener('message', onMessage);
		send({ type: 'compare', source, target, requestId });
		return () => window.removeEventListener('message', onMessage);
	}, [source, target, revision]);

	return state;
}

export function ComparePreview(props: { source: string; target: string; state: ReturnType<typeof useCompare> }) {
	const { source, target, state } = props;
	if (!source || !target) {
		return <Empty>Pick a source and a target branch.</Empty>;
	}
	if (source === target) {
		return <Empty>Pick two different branches.</Empty>;
	}
	if (state.loading && !state.result) {
		return <Empty>Comparing…</Empty>;
	}
	if (state.error) {
		return <div className="banner banner-error">{state.error}</div>;
	}
	const result = state.result;
	if (!result) {
		return null;
	}
	return (
		<div className="stack">
			{result.warning && <div className="banner banner-warn">{result.warning}</div>}
			{result.conflicts.length > 0 ? (
				<div className="banner banner-error">
					<strong>{result.conflicts.length} conflicting file{result.conflicts.length > 1 ? 's' : ''}</strong>
					<ul className="plain">{result.conflicts.map(p => <li key={p}><Badge state="C" /> {p}</li>)}</ul>
				</div>
			) : result.changes.length > 0 ? (
				<div className="banner banner-ok">No conflicts: {source} merges cleanly into {target}.</div>
			) : (
				<div className="banner">{source} adds nothing to {target}.</div>
			)}
			{result.changes.length > 0 && (
				<ul className="list">
					{result.changes.map(c => {
						const { name, dir } = fileName(c.path);
						return (
							<li key={c.path} className="row file-row"
								onClick={() => send({ type: 'openBranchDiff', path: c.path, state: c.state, source, target })}>
								<Badge state={c.state} />
								<span className="file-name">{name}</span>
								<span className="file-dir">{dir}</span>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
