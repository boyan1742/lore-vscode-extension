import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LoreError } from '../lore/cli';
import { isRepository, LoreService, ServiceSettings } from '../lore/service';
import { Message, PullRequestRecord, Request, TabId } from '../shared/protocol';
import { openBranchDiff, openWorkingDiff } from './diffProvider';

interface WebviewTarget {
	webview: vscode.Webview;
}

const REFRESH_DEBOUNCE_MS = 800;

/** Owns the LoreService for the current workspace folder and mediates between it and every open webview. */
export class Controller implements vscode.Disposable {
	private service?: LoreService;
	private readonly views = new Set<WebviewTarget>();
	private readonly disposables: vscode.Disposable[] = [];
	private watcher?: vscode.FileSystemWatcher;
	private refreshTimer?: NodeJS.Timeout;
	private healthTimer?: NodeJS.Timeout;
	private readonly statusBar: vscode.StatusBarItem;
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly output: vscode.OutputChannel,
	) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
		this.statusBar.command = 'lore.openPanel';
		this.disposables.push(
			this.statusBar,
			this.changeEmitter,
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.attach()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('lore')) {
					this.scheduleHealth();
					void this.service?.refresh({ scan: false });
				}
			}),
		);
		this.attach();
	}

	get currentService(): LoreService | undefined {
		return this.service;
	}

	private settings(): ServiceSettings {
		const cfg = vscode.workspace.getConfiguration('lore');
		return {
			executable: cfg.get<string>('path', 'lore') || 'lore',
			identity: cfg.get<string>('identity', ''),
			healthPort: cfg.get<number>('healthCheck.port', 41339),
			healthUrl: cfg.get<string>('healthCheck.url', ''),
			graphMaxRevisions: cfg.get<number>('graph.maxRevisions', 100),
		};
	}

	/** Picks the workspace folder that holds a Lore repository (or the first folder) and wires it up. */
	private attach(): void {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const folder = folders.find(f => isRepository(f.uri.fsPath)) ?? folders[0];
		const root = folder?.uri.fsPath;
		if (root === this.service?.root) {
			return;
		}
		this.detach();
		if (!root) {
			this.broadcastState();
			return;
		}
		const service = new LoreService(root, () => this.settings(), {
			load: id => this.context.workspaceState.get<PullRequestRecord[]>(`lore.prs.${id}`, []),
			save: (id, records) => { void this.context.workspaceState.update(`lore.prs.${id}`, records); },
		}, line => this.output.appendLine(line));
		this.service = service;
		const unsubscribe = service.onChange(() => this.broadcastState());
		this.disposables.push({ dispose: unsubscribe });

		// .lore/ is rewritten by every lore command; watching it would make refreshes feed themselves.
		this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
		const onFsEvent = (uri: vscode.Uri) => {
			if (/[\\/]\.lore([\\/]|$)/.test(uri.fsPath) || !vscode.workspace.getConfiguration('lore').get('autoRefresh', true)) {
				return;
			}
			this.scheduleRefresh();
		};
		this.watcher.onDidChange(onFsEvent);
		this.watcher.onDidCreate(onFsEvent);
		this.watcher.onDidDelete(onFsEvent);

		void service.refresh({ scan: true }).then(() => this.scheduleHealth());
	}

	private detach(): void {
		this.watcher?.dispose();
		this.watcher = undefined;
		clearTimeout(this.refreshTimer);
		clearTimeout(this.healthTimer);
		this.service = undefined;
	}

	private scheduleRefresh(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			if (this.service && !this.snapshotBusy()) {
				void this.service.refresh({ scan: true });
			}
		}, REFRESH_DEBOUNCE_MS);
	}

	private snapshotBusy(): boolean {
		return !!this.service?.snapshot().busy;
	}

	private scheduleHealth(): void {
		clearTimeout(this.healthTimer);
		const seconds = vscode.workspace.getConfiguration('lore').get<number>('healthCheck.intervalSeconds', 30);
		const service = this.service;
		if (!service || seconds <= 0) {
			return;
		}
		const tick = async () => {
			if (this.service !== service) {
				return;
			}
			await service.checkHealth();
			this.healthTimer = setTimeout(tick, seconds * 1000);
		};
		void tick();
	}

	// ---- webviews ------------------------------------------------------------------------

	register(target: WebviewTarget): vscode.Disposable {
		this.views.add(target);
		return { dispose: () => { this.views.delete(target); } };
	}

	private post(message: Message, only?: vscode.Webview): void {
		for (const view of this.views) {
			if (!only || view.webview === only) {
				void view.webview.postMessage(message);
			}
		}
	}

	broadcastState(): void {
		const snapshot = this.service?.snapshot() ?? {
			hasWorkspace: false, isRepo: false, branches: [], pullRequests: [],
			health: { state: 'unknown' as const }, identityConfigured: false,
		};
		this.post({ type: 'state', snapshot });
		this.updateStatusBar();
		this.changeEmitter.fire();
	}

	private updateStatusBar(): void {
		const snap = this.service?.snapshot();
		if (!snap?.isRepo || !snap.status) {
			this.statusBar.hide();
			return;
		}
		const health = snap.health.state === 'ok' ? '$(pass-filled)' : snap.health.state === 'down' ? '$(error)' : '$(circle-outline)';
		const dirty = snap.status.staged.length + snap.status.unstaged.length + snap.status.untracked.length;
		this.statusBar.text = `$(git-branch) ${snap.status.branch}${dirty ? ` ${dirty}*` : ''} ${health}`;
		this.statusBar.tooltip = snap.health.state === 'down' ? `Lore server unreachable: ${snap.health.error ?? ''}` : 'Open Lore';
		this.statusBar.show();
	}

	/** Remembered until a webview says it is ready, so navigating right after opening the panel still works. */
	private pendingNavigation?: { tab: TabId; source?: string };

	navigate(tab: TabId, source?: string): void {
		this.pendingNavigation = { tab, source };
		this.post({ type: 'navigate', tab, source });
	}

	// ---- request handling ----------------------------------------------------------------

	async handle(request: Request, from: vscode.Webview): Promise<void> {
		const service = this.service;
		if (request.type === 'ready') {
			this.broadcastState();
			if (this.pendingNavigation) {
				this.post({ type: 'navigate', ...this.pendingNavigation }, from);
				this.pendingNavigation = undefined;
			}
			if (service?.snapshot().isRepo) {
				void service.refresh({ scan: false, graph: true });
			}
			return;
		}
		if (request.type === 'showOutput') {
			this.output.show(true);
			return;
		}
		if (!service) {
			this.toast('error', 'Open a folder first.', from);
			return;
		}
		try {
			await this.dispatch(service, request, from);
		} catch (err) {
			this.reportError(err, from);
		}
	}

	private async dispatch(service: LoreService, request: Request, from: vscode.Webview): Promise<void> {
		switch (request.type) {
			case 'refresh':
				await service.refresh({ scan: request.scan ?? true, graph: true });
				if (service.snapshot().isRepo) {
					void service.checkHealth();
				}
				return;
			case 'loadGraph':
				await service.refreshGraph();
				return;
			case 'init':
				await service.operation('Creating repository', () => service.init(request.remoteUrl, request.name));
				this.scheduleHealth();
				return;
			case 'stage':
				await service.operation('Staging', () => service.stage(request.paths));
				return;
			case 'stageAll':
				await service.operation('Staging', () => service.stageAll());
				return;
			case 'unstage':
				await service.operation('Unstaging', () => service.unstage(request.paths));
				return;
			case 'discard': {
				const label = request.paths.length === 1 ? request.paths[0] : `${request.paths.length} files`;
				const choice = await vscode.window.showWarningMessage(
					`Discard changes to ${label}? This cannot be undone.`, { modal: true }, 'Discard');
				if (choice !== 'Discard') {
					return;
				}
				await service.operation('Discarding', () => service.discard(request.paths, !!request.untracked));
				return;
			}
			case 'commit': {
				// operation() rethrows on failure, so reaching the next line means the commit succeeded.
				await service.operation('Committing', () => service.commit(request.message));
				await service.refreshGraph();
				this.post({ type: 'committed' }, from);
				this.toast('info', 'Committed.', from);
				return;
			}
			case 'openFile':
				await vscode.window.showTextDocument(vscode.Uri.file(path.join(service.root, request.path)), { preview: false });
				return;
			case 'openDiff': {
				const full = path.join(service.root, request.path);
				if (request.state !== 'D' && !fs.existsSync(full)) {
					throw new Error(`${request.path} does not exist in the working tree.`);
				}
				await openWorkingDiff(service, request.path, request.state);
				return;
			}
			case 'openBranchDiff':
				await openBranchDiff(service, request.path, request.state, request.source, request.target);
				return;
			case 'resolve':
				await service.operation('Resolving', () => service.resolve(request.mode, request.paths));
				return;
			case 'abortMerge': {
				const choice = await vscode.window.showWarningMessage(
					'Abort the merge? Merge results and your conflict resolutions will be discarded.', { modal: true }, 'Abort merge');
				if (choice !== 'Abort merge') {
					return;
				}
				await service.operation('Aborting merge', () => service.abortMerge());
				await service.refreshGraph();
				return;
			}
			case 'createBranch':
				await service.operation('Creating branch', () => service.createBranch(request.name, request.switchTo));
				await service.refreshGraph();
				return;
			case 'switchBranch':
				await service.operation(`Switching to ${request.name}`, () => service.switchBranch(request.name));
				await service.refreshGraph();
				return;
			case 'archiveBranch': {
				const choice = await vscode.window.showWarningMessage(
					`Archive branch "${request.name}"?`, { modal: true }, 'Archive');
				if (choice !== 'Archive') {
					return;
				}
				await service.operation('Archiving', () => service.archiveBranch(request.name));
				await service.refreshGraph();
				return;
			}
			case 'push': {
				const text = await service.operation('Pushing', () => service.push());
				if (text) {
					this.toast('info', text, from);
				}
				return;
			}
			case 'pull': {
				const text = await service.operation('Pulling', () => service.pull());
				await service.refreshGraph();
				if (service.currentStatus?.conflicts.length) {
					this.toast('warn', 'Pull stopped on merge conflicts. Resolve them in the Changes tab.', from);
					this.navigate('changes');
				} else if (text) {
					this.toast('info', text, from);
				}
				return;
			}
			case 'compare':
				try {
					const result = await service.compare(request.source, request.target);
					this.post({ type: 'compare', requestId: request.requestId, result }, from);
				} catch (err) {
					this.post({ type: 'compare', requestId: request.requestId, error: errorText(err) }, from);
				}
				return;
			case 'merge': {
				const result = await service.operation(`Merging ${request.source}`, () => service.merge(request.source, request.message));
				await service.refreshGraph();
				if (result?.outcome === 'conflicted') {
					this.toast('warn', `Merge stopped on ${result.files.length} conflicting file(s). Resolve them in the Changes tab.`, from);
					this.navigate('changes');
				} else if (result?.outcome === 'committed') {
					this.toast('info', `Merged ${request.source}.`, from);
				}
				return;
			}
			case 'createPullRequest': {
				const result = await service.operation('Merging pull request', () =>
					service.createPullRequest(request.source, request.target, request.title, request.description));
				await service.refreshGraph();
				if (!result) {
					return;
				}
				if (!result.merged) {
					this.toast('error', `Cannot merge: ${result.conflicts.length} conflicting file(s).`, from);
					return;
				}
				this.toast('info', `Merged "${request.source}" into "${request.target}" and archived the branch.`, from);
				for (const warning of result.warnings) {
					this.toast('warn', warning, from);
				}
				return;
			}
			case 'healthCheck':
				await service.checkHealth();
				return;
		}
	}

	private toast(level: 'info' | 'warn' | 'error', text: string, only?: vscode.Webview): void {
		this.post({ type: 'toast', level, text }, only);
	}

	reportError(err: unknown, from?: vscode.Webview): void {
		const text = errorText(err);
		this.toast('error', text, from);
		if (err instanceof LoreError && /No commit identity/i.test(text)) {
			void vscode.window.showErrorMessage(text, 'Set identity').then(async choice => {
				if (choice !== 'Set identity') {
					return;
				}
				const identity = await vscode.window.showInputBox({ title: 'Lore identity', prompt: 'Name recorded on your commits', ignoreFocusOut: true });
				if (identity?.trim()) {
					await vscode.workspace.getConfiguration('lore').update('identity', identity.trim(), vscode.ConfigurationTarget.Global);
				}
			});
		}
		// A failed push usually means the remote branch moved; syncing is the way forward.
		if (err instanceof LoreError && err.args.includes('push')) {
			void vscode.window.showErrorMessage(`Push failed: ${text}`, 'Pull').then(choice => {
				if (choice === 'Pull') {
					void vscode.commands.executeCommand('lore.pull');
				}
			});
		}
	}

	dispose(): void {
		this.detach();
		this.disposables.forEach(d => d.dispose());
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
