import { FileChange, Snapshot } from '../shared/protocol';
import { Badge, Empty, fileName, IconButton, Section, shortSig } from './common';
import { send } from './vscode';

type Group = 'staged' | 'unstaged' | 'untracked';

function FileRow(props: { file: FileChange; group: Group }) {
	const { file, group } = props;
	const { name, dir } = fileName(file.path);
	const staged = group === 'staged';
	return (
		<li className="row file-row" onClick={() => send({ type: 'openDiff', path: file.path, state: file.state, staged })}>
			<Badge state={file.state} />
			<span className="file-name">{name}</span>
			<span className="file-dir">{dir}</span>
			<span className="spacer" />
			<span className="row-actions">
				{file.state !== 'D' && <IconButton title="Open file" onClick={() => send({ type: 'openFile', path: file.path })}>{'↗'}</IconButton>}
				{!staged && <IconButton title="Discard changes" onClick={() => send({ type: 'discard', paths: [file.path], untracked: group === 'untracked' })}>{'↺'}</IconButton>}
				{staged
					? <IconButton title="Unstage" onClick={() => send({ type: 'unstage', paths: [file.path] })}>{'−'}</IconButton>
					: <IconButton title="Stage" onClick={() => send({ type: 'stage', paths: [file.path] })}>+</IconButton>}
			</span>
		</li>
	);
}

function ConflictRow({ file }: { file: FileChange }) {
	const { name, dir } = fileName(file.path);
	const act = (mode: 'mine' | 'theirs' | 'resolved') => send({ type: 'resolve', mode, paths: [file.path] });
	return (
		<li className="row conflict-row">
			<div className="conflict-head" onClick={() => send({ type: 'openFile', path: file.path })} title="Open to edit the conflict markers">
				<Badge state="C" />
				<span className="file-name">{name}</span>
				<span className="file-dir">{dir}</span>
			</div>
			<div className="conflict-actions">
				<button className="btn btn-small" onClick={() => act('mine')} title="Keep the version from the current branch">Take mine</button>
				<button className="btn btn-small" onClick={() => act('theirs')} title="Take the version from the incoming branch">Take theirs</button>
				<button className="btn btn-small btn-secondary" onClick={() => act('resolved')} title="Mark the file as resolved after editing it">Mark resolved</button>
			</div>
		</li>
	);
}

export function Changes({ snapshot, draft, setDraft }: { snapshot: Snapshot; draft: string; setDraft: (v: string) => void }) {
	const status = snapshot.status;
	if (!status) {
		return <Empty>Loading status…</Empty>;
	}
	const merging = !!status.pendingMerge;
	const unresolved = status.conflicts.length;
	const unstaged = [...status.unstaged, ...status.untracked];
	const canCommit = status.staged.length > 0 && unresolved === 0 && draft.trim().length > 0 && !snapshot.busy;
	const commit = () => {
		if (!canCommit) {
			return;
		}
		// The draft is cleared by the host's "committed" message, so a failed commit keeps the text.
		send({ type: 'commit', message: draft });
	};
	const clean = !status.staged.length && !unstaged.length && !unresolved && !merging;

	return (
		<div className="stack">
			{merging && (
				<div className="banner banner-warn">
					<strong>Merge in progress</strong>
					<span>incoming {shortSig(status.pendingMerge ?? '')}</span>
					<span className="spacer" />
					<button className="btn btn-small btn-danger" onClick={() => send({ type: 'abortMerge' })}>Abort merge</button>
				</div>
			)}

			<div className="commit-box">
				<textarea
					value={draft}
					onChange={e => setDraft(e.target.value)}
					onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commit(); } }}
					placeholder={`Message (Ctrl+Enter to commit on ${status.branch})`}
					rows={3}
				/>
				<button className="btn" disabled={!canCommit} onClick={commit}
					title={unresolved ? 'Resolve all conflicts first' : !status.staged.length ? 'Stage something first' : 'Commit staged changes'}>
					{merging ? 'Commit merge' : 'Commit'}
				</button>
			</div>

			{unresolved > 0 && (
				<Section title="Merge conflicts" count={unresolved} tone="danger">
					<ul className="list">{status.conflicts.map(f => <ConflictRow key={f.path} file={f} />)}</ul>
				</Section>
			)}

			<Section title="Staged changes" count={status.staged.length}
				actions={status.staged.length > 0 && <IconButton title="Unstage all" onClick={() => send({ type: 'unstage', paths: status.staged.map(f => f.path) })}>{'−'}</IconButton>}>
				{status.staged.length
					? <ul className="list">{status.staged.map(f => <FileRow key={f.path} file={f} group="staged" />)}</ul>
					: <div className="hint">Nothing staged.</div>}
			</Section>

			<Section title="Changes" count={unstaged.length}
				actions={unstaged.length > 0 && <IconButton title="Stage all" onClick={() => send({ type: 'stageAll' })}>+</IconButton>}>
				{unstaged.length ? (
					<ul className="list">
						{status.unstaged.map(f => <FileRow key={`m:${f.path}`} file={f} group="unstaged" />)}
						{status.untracked.map(f => <FileRow key={`u:${f.path}`} file={f} group="untracked" />)}
					</ul>
				) : <div className="hint">{clean ? 'Working tree clean.' : 'No unstaged changes.'}</div>}
			</Section>
		</div>
	);
}
