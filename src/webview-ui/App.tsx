import { useCallback, useEffect, useRef, useState } from 'react';
import { Message, Snapshot, SyncState, TabId } from '../shared/protocol';
import { Branches } from './Branches';
import { Changes } from './Changes';
import { Empty } from './common';
import { Graph } from './Graph';
import { Merge } from './Merge';
import { PullRequest } from './PullRequest';
import { Server } from './Server';
import { loadUiState, saveUiState, send } from './vscode';

interface Toast { id: number; level: 'info' | 'warn' | 'error'; text: string }

const TABS: { id: TabId; label: string }[] = [
	{ id: 'changes', label: 'Changes' },
	{ id: 'history', label: 'History' },
	{ id: 'branches', label: 'Branches' },
	{ id: 'merge', label: 'Merge' },
	{ id: 'pr', label: 'Pull request' },
	{ id: 'server', label: 'Server' },
];

const SYNC_TEXT: Record<SyncState, string> = {
	unknown: '', inSync: 'in sync', ahead: 'ahead', behind: 'behind', diverged: 'diverged', noRemoteBranch: 'not pushed', noRemote: 'offline',
};

function InitView({ snapshot }: { snapshot: Snapshot }) {
	const [remote, setRemote] = useState('');
	return (
		<div className="stack pad">
			<h2>No Lore repository here</h2>
			<p className="hint">{snapshot.root}</p>
			<label className="field">
				<span>Remote URL (optional)</span>
				<input value={remote} onChange={e => setRemote(e.target.value)} placeholder="lore://127.0.0.1:41337/my-project" />
			</label>
			<div className="actions">
				<button className="btn" onClick={() => send({ type: 'init', remoteUrl: remote.trim() || undefined })}>Initialize repository</button>
			</div>
			<p className="hint">Leave the URL empty to create an offline repository. Branch merging and pushing need a remote.</p>
		</div>
	);
}

export function App() {
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [ui, setUi] = useState(() => loadUiState<{ tab: TabId }>({ tab: 'changes' }));
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [draft, setDraft] = useState('');
	const [mergeSource, setMergeSource] = useState('');
	const toastId = useRef(0);

	const goto = useCallback((tab: TabId, source?: string) => {
		setUi({ tab });
		saveUiState({ tab });
		if (source !== undefined) {
			setMergeSource(source);
		}
	}, []);

	const pushToast = useCallback((level: Toast['level'], text: string) => {
		const id = ++toastId.current;
		setToasts(t => [...t.slice(-3), { id, level, text }]);
		setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), level === 'error' ? 9000 : 4500);
	}, []);

	useEffect(() => {
		const onMessage = (event: MessageEvent<Message>) => {
			const m = event.data;
			if (m.type === 'state') {
				setSnapshot(m.snapshot);
			} else if (m.type === 'toast') {
				pushToast(m.level, m.text);
			} else if (m.type === 'committed') {
				setDraft('');
			} else if (m.type === 'navigate') {
				goto(m.tab, m.source);
			}
		};
		window.addEventListener('message', onMessage);
		send({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, [goto, pushToast]);

	if (!snapshot) {
		return <Empty>Loading…</Empty>;
	}
	if (!snapshot.hasWorkspace) {
		return <Empty>Open a folder to use Lore.</Empty>;
	}
	if (snapshot.cliError) {
		return (
			<div className="stack pad">
				<div className="banner banner-error">{snapshot.cliError}</div>
				<div className="actions"><button className="btn" onClick={() => send({ type: 'refresh' })}>Retry</button></div>
			</div>
		);
	}
	if (!snapshot.isRepo) {
		return <InitView snapshot={snapshot} />;
	}

	const status = snapshot.status;
	const conflicts = status?.conflicts.length ?? 0;
	const changeCount = status ? status.staged.length + status.unstaged.length + status.untracked.length : 0;
	const health = snapshot.health;
	const hasRemote = !!snapshot.repoInfo?.remoteUrl;
	const busy = !!snapshot.busy;

	return (
		<div className="app">
			<header className="topbar">
				<div className="branch-pill" title="Current branch">
					<span aria-hidden="true">{'⎇'}</span> {status?.branch ?? '…'}
					{status && SYNC_TEXT[status.sync] && hasRemote && <span className={`sync sync-${status.sync}`}>{SYNC_TEXT[status.sync]}</span>}
				</div>
				<span className="spacer" />
				<button className="btn btn-small btn-secondary" disabled={busy || !hasRemote} onClick={() => send({ type: 'pull' })}
					title={hasRemote ? 'Synchronize with the remote (lore sync)' : 'No remote configured'}>Pull</button>
				<button className="btn btn-small" disabled={busy || !hasRemote} onClick={() => send({ type: 'push' })}
					title={hasRemote ? 'Push the current branch' : 'No remote configured'}>Push</button>
				<button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => send({ type: 'refresh' })}>{'↻'}</button>
				<button className="icon-btn" title={`Server: ${health.state}`} aria-label="Server health" onClick={() => goto('server')}>
					<span className={`dot dot-${health.state}`} />
				</button>
			</header>

			<div className={`progress${busy ? ' active' : ''}`} role="status" aria-live="polite">{snapshot.busy ?? ''}</div>

			<nav className="tabs" role="tablist">
				{TABS.map(t => (
					<button key={t.id} role="tab" aria-selected={ui.tab === t.id} className={`tab${ui.tab === t.id ? ' active' : ''}`} onClick={() => goto(t.id)}>
						{t.label}
						{t.id === 'changes' && changeCount > 0 && <span className={`pill${conflicts ? ' pill-danger' : ''}`}>{conflicts || changeCount}</span>}
					</button>
				))}
			</nav>

			<main className="content" role="tabpanel">
				{snapshot.lastError && !busy && <div className="banner banner-error">{snapshot.lastError}</div>}
				{ui.tab === 'changes' && <Changes snapshot={snapshot} draft={draft} setDraft={setDraft} />}
				{ui.tab === 'history' && <Graph graph={snapshot.graph} currentBranch={status?.branch} onRefClick={name => goto('merge', name)} />}
				{ui.tab === 'branches' && <Branches snapshot={snapshot} goto={goto} />}
				{ui.tab === 'merge' && <Merge snapshot={snapshot} source={mergeSource} setSource={setMergeSource} goto={goto} />}
				{ui.tab === 'pr' && <PullRequest snapshot={snapshot} />}
				{ui.tab === 'server' && <Server snapshot={snapshot} />}
			</main>

			<div className="toasts" aria-live="polite">
				{toasts.map(t => <div key={t.id} className={`toast toast-${t.level}`}>{t.text}</div>)}
			</div>
		</div>
	);
}
