import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	BranchEntry, CompareResult, ConflictMode, GraphData, HealthInfo, PullRequestRecord,
	RepoInfo, RepoStatus, Snapshot,
} from '../shared/protocol';
import { CliConfig, LoreCli, LoreError } from './cli';
import { buildGraph } from './graph';
import { checkHealth } from './health';
import {
	HistoryEntry, isZeroHash, parseBranchDiff, parseBranchInfo, parseBranchList, parseHistory,
	parseMergeOutput, parseRepositoryInfo, parseStatus,
} from './parsers';

export interface ServiceSettings extends CliConfig {
	healthPort: number;
	healthUrl: string;
	graphMaxRevisions: number;
}

export interface PullRequestStore {
	load(repositoryId: string): PullRequestRecord[];
	save(repositoryId: string, records: PullRequestRecord[]): void;
}

export interface MergeResult {
	outcome: 'committed' | 'conflicted' | 'staged';
	files: string[];
	signature?: string;
}

export interface PullRequestResult {
	merged: boolean;
	conflicts: string[];
	record?: PullRequestRecord;
	warnings: string[];
}

export function isRepository(root: string): boolean {
	return fs.existsSync(path.join(root, '.lore'));
}

export class LoreService {
	readonly cli: LoreCli;
	private status?: RepoStatus;
	private branches: BranchEntry[] = [];
	private repoInfo?: RepoInfo;
	private graph?: GraphData;
	private graphWanted = false;
	private health: HealthInfo = { state: 'unknown' };
	private pullRequests: PullRequestRecord[] = [];
	private busy?: string;
	private cliError?: string;
	private lastError?: string;
	private readonly listeners = new Set<() => void>();

	constructor(
		readonly root: string,
		private readonly settings: () => ServiceSettings,
		private readonly prStore: PullRequestStore,
		log: (line: string) => void,
	) {
		this.cli = new LoreCli(root, settings, log);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		this.listeners.forEach(l => l());
	}

	snapshot(): Snapshot {
		return {
			hasWorkspace: true,
			isRepo: isRepository(this.root),
			root: this.root,
			busy: this.busy,
			status: this.status,
			branches: this.branches,
			repoInfo: this.repoInfo,
			health: this.health,
			graph: this.graph,
			pullRequests: this.pullRequests,
			cliError: this.cliError,
			lastError: this.lastError,
			identityConfigured: !!this.settings().identity,
		};
	}

	get currentStatus(): RepoStatus | undefined {
		return this.status;
	}

	get branchEntries(): BranchEntry[] {
		return this.branches;
	}

	/** Wraps a user-visible operation: sets the busy flag, captures errors, refreshes afterwards. */
	async operation<T>(label: string, work: () => Promise<T>, options: { refresh?: boolean; scan?: boolean } = {}): Promise<T | undefined> {
		this.busy = label;
		this.lastError = undefined;
		this.emit();
		try {
			return await work();
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
			throw err;
		} finally {
			this.busy = undefined;
			if (options.refresh !== false) {
				await this.refresh({ scan: options.scan ?? true }).catch(() => undefined);
			}
			this.emit();
		}
	}

	// ---- reading state -------------------------------------------------------------------

	async refresh(options: { scan?: boolean; graph?: boolean } = {}): Promise<void> {
		if (options.graph) {
			this.graphWanted = true;
		}
		if (!isRepository(this.root)) {
			this.status = undefined;
			this.branches = [];
			this.graph = undefined;
			this.emit();
			return;
		}
		try {
			const statusArgs = options.scan === false ? ['status'] : ['status', '--scan'];
			const [statusOut, branchOut] = await Promise.all([
				this.cli.run(statusArgs),
				this.cli.run(['branch', 'list', '--archived']),
			]);
			this.cliError = undefined;
			this.status = parseStatus(statusOut.stdout);
			const list = parseBranchList(branchOut.stdout);
			this.branches = await this.enrichBranches(list.entries);
			if (this.status.sync === 'unknown' && !this.repoInfo?.remoteUrl && this.status.remoteRevision === undefined) {
				this.status.sync = 'noRemote';
			}
			if (!this.repoInfo) {
				await this.loadRepoInfo();
			}
			if (this.graphWanted) {
				this.graph = await this.loadGraph();
			}
			this.pullRequests = this.status.repositoryId ? this.prStore.load(this.status.repositoryId) : [];
		} catch (err) {
			this.handleReadError(err);
		}
		this.emit();
	}

	private handleReadError(err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		if (err instanceof LoreError && err.exitCode === null) {
			this.cliError = message;
		} else {
			this.lastError = message;
		}
	}

	private async enrichBranches(entries: BranchEntry[]): Promise<BranchEntry[]> {
		const infos = await Promise.all(entries.filter(e => e.local || e.archived).map(async e => {
			try {
				const out = await this.cli.run(['branch', 'info', e.name]);
				return [e.name, parseBranchInfo(out.stdout)] as const;
			} catch {
				return [e.name, {}] as const;
			}
		}));
		const byName = new Map(infos);
		return entries
			.map(e => ({ ...e, ...byName.get(e.name) }))
			.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
	}

	async loadRepoInfo(): Promise<void> {
		try {
			const out = await this.cli.run(['repository', 'info']);
			this.repoInfo = parseRepositoryInfo(out.stdout);
		} catch {
			this.repoInfo = {};
		}
	}

	async loadGraph(): Promise<GraphData> {
		this.graphWanted = true;
		const limit = this.settings().graphMaxRevisions;
		const live = this.branches.filter(b => b.local && !b.archived);
		const histories: HistoryEntry[][] = [];
		for (const branch of live) {
			try {
				const out = await this.cli.run(['history', '--branch', branch.name, String(limit)]);
				histories.push(parseHistory(out.stdout));
			} catch {
				// A branch with no revisions yet is simply absent from the graph.
			}
		}
		// Merged-and-archived branches can no longer be listed by name, but their revisions are
		// still reachable from the merge commit's second parent.
		const known = new Set(histories.flat().map(e => e.signature));
		for (let fetched = 0; fetched < 20; fetched++) {
			const missing = histories.flat()
				.flatMap(e => [e.mergeParent, ...e.parents])
				.find((sig): sig is string => !!sig && !known.has(sig));
			if (!missing) {
				break;
			}
			known.add(missing);
			try {
				const out = await this.cli.run(['history', '--revision', missing, String(limit)]);
				const entries = parseHistory(out.stdout);
				entries.forEach(e => known.add(e.signature));
				histories.push(entries);
			} catch {
				break;
			}
		}
		const branchNames = new Map<string, string>();
		const tips = new Map<string, string[]>();
		for (const b of this.branches) {
			if (b.id) {
				branchNames.set(b.id, b.name);
			}
			if (b.latest && !isZeroHash(b.latest) && !b.archived) {
				tips.set(b.latest, [...(tips.get(b.latest) ?? []), b.name]);
			}
		}
		const graph = buildGraph({ histories, branchNames, tips, headSignature: this.status?.signature, limit });
		this.graph = graph;
		return graph;
	}

	async refreshGraph(): Promise<void> {
		this.graph = await this.loadGraph();
		this.emit();
	}

	async checkHealth(): Promise<void> {
		this.health = { ...this.health, state: 'checking' };
		this.emit();
		if (!this.repoInfo && isRepository(this.root)) {
			await this.loadRepoInfo();
		}
		const s = this.settings();
		this.health = await checkHealth({ url: s.healthUrl || undefined, remoteUrl: this.repoInfo?.remoteUrl, httpPort: s.healthPort });
		this.emit();
	}

	get hasRemote(): boolean {
		return !!this.repoInfo?.remoteUrl;
	}

	// ---- repository ----------------------------------------------------------------------

	async init(remoteUrl: string | undefined, name: string | undefined): Promise<void> {
		const args = ['repository', 'create'];
		if (remoteUrl) {
			args.push(remoteUrl);
		} else {
			args.unshift('--offline');
			args.push(name || path.basename(this.root));
		}
		await this.cli.run(args);
		this.repoInfo = undefined;
	}

	// ---- staging & commits ---------------------------------------------------------------

	async stage(paths: string[]): Promise<void> {
		if (paths.length) {
			await this.cli.run(['stage', ...paths]);
		}
	}

	async stageAll(): Promise<void> {
		const s = this.status;
		if (!s) {
			return;
		}
		await this.stage([...s.unstaged, ...s.untracked].map(f => f.path));
	}

	async unstage(paths: string[]): Promise<void> {
		if (paths.length) {
			await this.cli.run(['unstage', ...paths]);
		}
	}

	async discard(paths: string[], untracked: boolean): Promise<void> {
		if (paths.length) {
			await this.cli.run(['reset', ...(untracked ? ['--purge'] : []), ...paths]);
		}
	}

	async commit(message: string): Promise<void> {
		const text = message.trim();
		if (!text) {
			throw new Error('Enter a commit message.');
		}
		await this.cli.run(['commit', text]);
	}

	// ---- branches ------------------------------------------------------------------------

	async createBranch(name: string, switchTo: boolean): Promise<void> {
		await this.cli.run(['branch', 'create', name]);
		if (switchTo) {
			await this.cli.run(['branch', 'switch', name]);
		}
	}

	async switchBranch(name: string): Promise<void> {
		await this.assertNoPendingWork('switch branches');
		await this.cli.run(['branch', 'switch', name]);
	}

	async archiveBranch(name: string): Promise<void> {
		if (this.status?.branch === name) {
			throw new Error('Switch to another branch before archiving the current one.');
		}
		await this.cli.run(['branch', 'archive', name]);
	}

	/** Re-reads the working tree first: the cached status may predate edits made outside the UI. */
	private async assertNoPendingWork(action: string): Promise<void> {
		await this.refresh({ scan: true });
		const s = this.status;
		if (s?.pendingMerge) {
			throw new Error(`Finish or abort the merge in progress before you ${action}.`);
		}
		if (s && (s.staged.length || s.unstaged.length)) {
			throw new Error(`Commit or discard your changes before you ${action}.`);
		}
	}

	// ---- remote --------------------------------------------------------------------------

	async push(): Promise<string> {
		const out = await this.cli.run(['push']);
		return lastMeaningfulLine(out.stdout) ?? 'Pushed.';
	}

	async pull(): Promise<string> {
		const out = await this.cli.run(['sync']);
		if (/Remote and local branch have diverged/.test(out.stdout)) {
			return 'Merged remote changes into your branch. Push to publish the result.';
		}
		if (/^Already on branch/m.test(out.stdout)) {
			return 'Already up to date.';
		}
		return lastMeaningfulLine(out.stdout) ?? 'Synchronized.';
	}

	// ---- merging -------------------------------------------------------------------------

	async compare(source: string, target: string): Promise<CompareResult> {
		if (source === target) {
			throw new Error('Pick two different branches.');
		}
		const out = await this.cli.run(['branch', 'diff', '--source', source, target]);
		const diff = parseBranchDiff(out.stdout);
		const byName = new Map(this.branches.map(b => [b.name, b]));
		const result: CompareResult = {
			source,
			target,
			changes: diff.changes,
			conflicts: diff.conflicts,
			sourceTip: byName.get(source)?.latest,
			targetTip: byName.get(target)?.latest,
		};
		const sync = this.status?.sync;
		if (this.status?.branch === target && (sync === 'behind' || sync === 'diverged')) {
			result.warning = `"${target}" is ${sync} the remote. Pull first so the merge is based on the latest changes.`;
		}
		return result;
	}

	/** Merges `source` into the current branch. Clean merges commit on their own. */
	async merge(source: string, message?: string): Promise<MergeResult> {
		await this.assertNoPendingWork('start a merge');
		const text = message?.trim() || `Merge ${source} into ${this.status?.branch ?? 'current branch'}`;
		const out = await this.cli.run(['branch', 'merge', source, '--message', text]);
		const outcome = parseMergeOutput(out.stdout);
		if (outcome.kind === 'conflicted') {
			return { outcome: 'conflicted', files: outcome.files };
		}
		return { outcome: outcome.kind, files: [], signature: outcome.kind === 'committed' ? outcome.signature : undefined };
	}

	async resolve(mode: ConflictMode, paths: string[]): Promise<void> {
		if (!paths.length) {
			return;
		}
		const args = mode === 'resolved' ? ['branch', 'merge', 'resolve', ...paths] : ['branch', 'merge', 'resolve', mode, ...paths];
		await this.cli.run(args);
	}

	async abortMerge(): Promise<void> {
		await this.cli.run(['branch', 'merge', 'abort']);
	}

	/**
	 * Lore has no pull requests, so this emulates one: compare, refuse on conflicts, otherwise merge
	 * the source into the target, push the target, archive the source and remember what happened.
	 */
	async createPullRequest(source: string, target: string, title: string, description: string): Promise<PullRequestResult> {
		const warnings: string[] = [];
		if (!title.trim()) {
			throw new Error('Give the pull request a title.');
		}
		await this.assertNoPendingWork('create a pull request');

		const compare = await this.compare(source, target);
		if (compare.conflicts.length) {
			return { merged: false, conflicts: compare.conflicts, warnings };
		}
		if (!compare.changes.length) {
			throw new Error(`"${source}" has nothing to merge into "${target}".`);
		}

		const originalBranch = this.status?.branch;
		if (originalBranch !== target) {
			await this.cli.run(['branch', 'switch', target]);
		}
		if (this.hasRemote) {
			// Merge on top of what the server has. Sync fast-forwards or merges, and only stops on conflicts.
			try {
				await this.cli.run(['sync']);
			} catch (err) {
				warnings.push(`Could not sync "${target}" before merging: ${err instanceof Error ? err.message : err}`);
			}
			await this.refresh({ scan: true });
			if (this.status?.pendingMerge) {
				throw new Error(`Syncing "${target}" with the server stopped on conflicts. Resolve them in the Changes tab, then create the pull request again.`);
			}
		}
		const message = description.trim() ? `${title.trim()}\n\n${description.trim()}` : title.trim();
		const merge = await this.merge(source, message);
		if (merge.outcome === 'conflicted') {
			await this.abortMerge();
			return { merged: false, conflicts: merge.files, warnings };
		}
		if (merge.outcome !== 'committed') {
			await this.abortMerge().catch(() => undefined);
			throw new Error('The merge did not commit; it was rolled back.');
		}

		const record: PullRequestRecord = {
			id: merge.signature ?? String(Date.now()),
			title: title.trim(),
			description: description.trim(),
			source,
			target,
			sourceTip: compare.sourceTip ?? '',
			targetBefore: compare.targetTip ?? '',
			mergeSignature: merge.signature,
			files: compare.changes,
			mergedAt: Date.now(),
			archived: false,
		};

		let pushed = !this.hasRemote;
		if (this.hasRemote) {
			try {
				await this.cli.run(['push']);
				pushed = true;
			} catch (err) {
				warnings.push(`Merged locally, but pushing "${target}" failed: ${err instanceof Error ? err.message : err}. Pull, then push; "${source}" was left unarchived.`);
			}
		}
		// Archive only once the merge is on the server, so a failed push never leaves the work reachable solely through an archived branch.
		if (pushed) {
			try {
				await this.cli.run(['branch', 'archive', source]);
				record.archived = true;
			} catch (err) {
				warnings.push(`Merged, but archiving "${source}" failed: ${err instanceof Error ? err.message : err}`);
			}
			if (record.archived && this.hasRemote) {
				warnings.push(`"${source}" is archived locally; Lore cannot remove it from the server.`);
			}
		}

		const repoId = this.status?.repositoryId;
		if (repoId) {
			this.prStore.save(repoId, [record, ...this.prStore.load(repoId)].slice(0, 100));
		}
		return { merged: true, conflicts: [], record, warnings };
	}

	// ---- file content --------------------------------------------------------------------

	/** Contents of `filePath` at the given revision signature; empty when the file does not exist there. */
	async fileAtRevision(filePath: string, revision: string): Promise<string> {
		if (!revision || isZeroHash(revision)) {
			return '';
		}
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-vscode-'));
		const out = path.join(dir, 'content');
		try {
			await this.cli.run(['file', 'write', '--path', filePath, '--revision', revision, '--output', out]);
			return fs.readFileSync(out, 'utf8');
		} catch (err) {
			if (err instanceof LoreError && err.exitCode !== null && /not found/i.test(err.message)) {
				return '';
			}
			throw err;
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
}

function lastMeaningfulLine(text: string): string | undefined {
	const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	return lines[lines.length - 1];
}
