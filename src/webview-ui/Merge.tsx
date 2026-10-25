import { useEffect, useState } from 'react';
import { Snapshot, TabId } from '../shared/protocol';
import { Graph } from './Graph';
import { ComparePreview, useCompare } from './Compare';
import { Section } from './common';
import { send } from './vscode';

export function Merge(props: { snapshot: Snapshot; source: string; setSource: (s: string) => void; goto: (tab: TabId, source?: string) => void }) {
	const { snapshot, source, setSource } = props;
	const current = snapshot.status?.branch ?? '';
	const candidates = snapshot.branches.filter(b => b.local && !b.archived && b.name !== current);
	const [message, setMessage] = useState('');

	useEffect(() => {
		if (source && !candidates.some(b => b.name === source)) {
			setSource('');
		}
	}, [source, candidates.map(b => b.name).join('|')]);

	const compare = useCompare(source, current, snapshot.status?.signature);
	const conflicts = compare.result?.conflicts.length ?? 0;
	const nothing = compare.result && compare.result.changes.length === 0 && conflicts === 0;
	const disabled = !source || !!compare.error || !!nothing || !!snapshot.status?.pendingMerge || !!snapshot.busy;

	return (
		<div className="stack">
			<Section title="Branch graph">
				<Graph graph={snapshot.graph} currentBranch={current} compact onRefClick={name => setSource(name)} />
			</Section>

			<Section title={`Merge into ${current}`}>
				<label className="field">
					<span>Source branch</span>
					<select value={source} onChange={e => setSource(e.target.value)}>
						<option value="">Select a branch…</option>
						{candidates.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
					</select>
				</label>
				<label className="field">
					<span>Merge message (optional)</span>
					<input value={message} onChange={e => setMessage(e.target.value)} placeholder={source ? `Merge ${source} into ${current}` : ''} />
				</label>
				{source && <ComparePreview source={source} target={current} state={compare} />}
				{snapshot.status?.pendingMerge && <div className="banner banner-warn">Finish the merge in progress in the Changes tab first.</div>}
				<div className="actions">
					<button className="btn" disabled={disabled} onClick={() => send({ type: 'merge', source, message: message || undefined })}>
						{conflicts ? `Merge and resolve ${conflicts} conflict${conflicts > 1 ? 's' : ''}` : 'Merge'}
					</button>
				</div>
				<div className="hint">Clean merges commit automatically. If files conflict, the merge stops and the conflicts appear in the Changes tab.</div>
			</Section>
		</div>
	);
}
