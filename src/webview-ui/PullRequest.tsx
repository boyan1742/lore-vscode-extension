import { useEffect, useState } from 'react';
import { Snapshot } from '../shared/protocol';
import { ComparePreview, useCompare } from './Compare';
import { Empty, Section, shortSig, timeAgo } from './common';
import { send } from './vscode';

export function PullRequest({ snapshot }: { snapshot: Snapshot }) {
	const live = snapshot.branches.filter(b => b.local && !b.archived);
	const current = snapshot.status?.branch ?? '';
	const defaultTarget = snapshot.repoInfo?.defaultBranch ?? (live.find(b => b.name === 'main') ? 'main' : live[0]?.name ?? '');
	const [source, setSource] = useState(current && current !== defaultTarget ? current : '');
	const [target, setTarget] = useState(defaultTarget);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');

	useEffect(() => {
		if (!target && defaultTarget) {
			setTarget(defaultTarget);
		}
	}, [defaultTarget]);

	const compare = useCompare(source, target, snapshot.status?.signature);
	const result = compare.result;
	const dirty = !!snapshot.status && (snapshot.status.staged.length > 0 || snapshot.status.unstaged.length > 0);
	const blocked = dirty || !!snapshot.status?.pendingMerge;
	const canCreate = !!result && result.conflicts.length === 0 && result.changes.length > 0 && !blocked && title.trim().length > 0 && !snapshot.busy;

	return (
		<div className="stack">
			<Section title="New pull request">
				<div className="hint">
					Lore has no server-side pull requests. This compares two branches; if they do not conflict, it merges the source into the target, pushes the target and archives the source branch.
				</div>
				<div className="grid-2">
					<label className="field">
						<span>Source (merge this)</span>
						<select value={source} onChange={e => setSource(e.target.value)}>
							<option value="">Select…</option>
							{live.filter(b => b.name !== target).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
						</select>
					</label>
					<label className="field">
						<span>Target (into)</span>
						<select value={target} onChange={e => setTarget(e.target.value)}>
							{live.filter(b => b.name !== source).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
						</select>
					</label>
				</div>
				<label className="field">
					<span>Title</span>
					<input value={title} onChange={e => setTitle(e.target.value)} placeholder="What does this change do?" />
				</label>
				<label className="field">
					<span>Description</span>
					<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
				</label>
			</Section>

			<Section title="Changes">
				<ComparePreview source={source} target={target} state={compare} />
			</Section>

			{blocked && <div className="banner banner-warn">Commit or discard your staged and modified files (and finish any merge) before merging a pull request.</div>}
			<div className="actions">
				<button className="btn" disabled={!canCreate}
					onClick={() => { send({ type: 'createPullRequest', source, target, title, description }); setTitle(''); setDescription(''); }}>
					Create &amp; merge
				</button>
				{result && result.conflicts.length > 0 && <span className="error-text">Resolve conflicts on {source} first.</span>}
			</div>

			<Section title="Merged pull requests" count={snapshot.pullRequests.length}>
				{snapshot.pullRequests.length === 0 ? <Empty>None yet.</Empty> : (
					<ul className="list">
						{snapshot.pullRequests.map(pr => (
							<li key={pr.id} className="row pr-row">
								<div className="pr-title">{pr.title}</div>
								<div className="file-dir">
									{pr.source} {'→'} {pr.target} {'·'} {pr.files.length} file{pr.files.length === 1 ? '' : 's'} {'·'} {timeAgo(new Date(pr.mergedAt).toISOString())}
									{pr.mergeSignature && <> {'·'} <span className="mono">{shortSig(pr.mergeSignature)}</span></>}
									{pr.archived && <> {'·'} archived</>}
								</div>
							</li>
						))}
					</ul>
				)}
			</Section>
		</div>
	);
}
