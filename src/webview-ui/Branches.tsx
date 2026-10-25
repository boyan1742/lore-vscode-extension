import { useState } from 'react';
import { BranchEntry, Snapshot, TabId } from '../shared/protocol';
import { Empty, IconButton, Section, shortSig } from './common';
import { send } from './vscode';

const VALID_NAME = /^[^\s~^:?*[\\]+$/;

function BranchRow(props: { branch: BranchEntry; hasRemote: boolean; goto: (tab: TabId, source?: string) => void }) {
	const { branch: b, goto } = props;
	return (
		<li className={`row branch-row${b.current ? ' current' : ''}`}>
			<span className="branch-mark">{b.current ? '●' : ''}</span>
			<span className="file-name">{b.name}</span>
			{b.latest && <span className="file-dir mono">{shortSig(b.latest)}</span>}
			{b.local && !b.remote && props.hasRemote && <span className="tag" title="Not pushed yet">local</span>}
			{b.remote && !b.local && <span className="tag" title="Exists on the server only">remote</span>}
			<span className="spacer" />
			<span className="row-actions always">
				{!b.current && b.local && !b.archived && (
					<>
						<button className="btn btn-small" onClick={() => send({ type: 'switchBranch', name: b.name })}>Switch</button>
						<button className="btn btn-small btn-secondary" title="Preview and merge into the current branch" onClick={() => goto('merge', b.name)}>Merge…</button>
						<IconButton title="Archive branch" onClick={() => send({ type: 'archiveBranch', name: b.name })}>{'▤'}</IconButton>
					</>
				)}
			</span>
		</li>
	);
}

export function Branches({ snapshot, goto }: { snapshot: Snapshot; goto: (tab: TabId, source?: string) => void }) {
	const [name, setName] = useState('');
	const [switchTo, setSwitchTo] = useState(true);
	const taken = snapshot.branches.some(b => b.name === name.trim() && (b.local || b.archived));
	const valid = name.trim().length > 0 && VALID_NAME.test(name.trim()) && !taken;
	const create = () => {
		if (!valid) {
			return;
		}
		send({ type: 'createBranch', name: name.trim(), switchTo });
		setName('');
	};
	const hasRemote = !!snapshot.repoInfo?.remoteUrl;
	const local = snapshot.branches.filter(b => b.local && !b.archived);
	const remoteOnly = snapshot.branches.filter(b => b.remote && !b.local && !b.archived);
	const archived = snapshot.branches.filter(b => b.archived);

	return (
		<div className="stack">
			<Section title={`New branch from ${snapshot.status?.branch ?? 'HEAD'}`}>
				<form className="inline-form" onSubmit={e => { e.preventDefault(); create(); }}>
					<input value={name} onChange={e => setName(e.target.value)} placeholder="branch-name" aria-label="New branch name" />
					<button className="btn" type="submit" disabled={!valid}>Create</button>
				</form>
				<label className="check"><input type="checkbox" checked={switchTo} onChange={e => setSwitchTo(e.target.checked)} /> Switch to it</label>
				{taken && <div className="hint error-text">A branch with that name already exists.</div>}
			</Section>

			<Section title="Branches" count={local.length}>
				{local.length
					? <ul className="list">{local.map(b => <BranchRow key={b.name} branch={b} hasRemote={hasRemote} goto={goto} />)}</ul>
					: <Empty>No branches.</Empty>}
			</Section>

			{remoteOnly.length > 0 && (
				<Section title="On the server only" count={remoteOnly.length}>
					<ul className="list">{remoteOnly.map(b => <BranchRow key={b.name} branch={b} hasRemote={hasRemote} goto={goto} />)}</ul>
					<div className="hint">These branches are on the server but not in your repository.</div>
				</Section>
			)}

			{archived.length > 0 && (
				<Section title="Archived" count={archived.length}>
					<ul className="list">{archived.map(b => <BranchRow key={b.name} branch={b} hasRemote={hasRemote} goto={goto} />)}</ul>
				</Section>
			)}
		</div>
	);
}
