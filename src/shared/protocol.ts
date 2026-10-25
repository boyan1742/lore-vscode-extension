// Types shared by the extension host and the React webview. Type-only: no runtime code lives here.

export type FileState = 'A' | 'M' | 'D' | 'R' | 'C';

export interface FileChange {
	path: string;
	state: FileState;
	conflict?: boolean;
}

export type SyncState = 'unknown' | 'inSync' | 'ahead' | 'behind' | 'diverged' | 'noRemoteBranch' | 'noRemote';

export interface RepoStatus {
	repositoryId: string;
	branch: string;
	revision: number;
	signature: string;
	remoteRevision?: number;
	remoteSignature?: string;
	sync: SyncState;
	syncText?: string;
	pendingMerge?: string; // incoming revision signature while a merge is in progress
	staged: FileChange[];
	unstaged: FileChange[];
	untracked: FileChange[];
	conflicts: FileChange[];
}

export interface BranchEntry {
	name: string;
	current: boolean;
	local: boolean;
	remote: boolean;
	archived: boolean;
	id?: string;
	latest?: string;
}

export interface GraphRow {
	signature: string;
	revision: number;
	message: string;
	author: string;
	date: string;
	branchId: string;
	branchName: string;
	refs: string[]; // names of branches whose latest revision is this one
	parents: string[];
	col: number;
	color: number;
	isMerge: boolean;
	isHead: boolean;
}

export interface GraphEdge {
	fromRow: number;
	toRow: number; // may equal rows.length when the parent is outside the loaded window
	fromCol: number;
	lane: number;
	toCol: number;
	color: number;
}

export interface GraphData {
	rows: GraphRow[];
	edges: GraphEdge[];
	columns: number;
	truncated: boolean;
}

export type HealthState = 'unknown' | 'checking' | 'ok' | 'down' | 'noRemote';

export interface HealthInfo {
	state: HealthState;
	url?: string;
	latencyMs?: number;
	checkedAt?: number;
	error?: string;
}

export interface RepoInfo {
	name?: string;
	id?: string;
	remoteUrl?: string;
	defaultBranch?: string;
	creator?: string;
	created?: string;
}

export interface PullRequestRecord {
	id: string;
	title: string;
	description: string;
	source: string;
	target: string;
	sourceTip: string;
	targetBefore: string;
	mergeSignature?: string;
	files: FileChange[];
	mergedAt: number;
	archived: boolean;
}

export interface Snapshot {
	hasWorkspace: boolean;
	isRepo: boolean;
	root?: string;
	busy?: string;
	status?: RepoStatus;
	branches: BranchEntry[];
	repoInfo?: RepoInfo;
	health: HealthInfo;
	graph?: GraphData;
	pullRequests: PullRequestRecord[];
	cliError?: string; // set when the lore executable cannot be run
	lastError?: string;
	identityConfigured: boolean;
}

export interface CompareResult {
	source: string;
	target: string;
	changes: FileChange[];
	conflicts: string[];
	sourceTip?: string;
	targetTip?: string;
	warning?: string;
}

export type ConflictMode = 'mine' | 'theirs' | 'resolved';

// webview -> host
export type Request =
	| { type: 'ready' }
	| { type: 'refresh'; scan?: boolean }
	| { type: 'loadGraph' }
	| { type: 'init'; remoteUrl?: string; name?: string }
	| { type: 'stage'; paths: string[] }
	| { type: 'stageAll' }
	| { type: 'unstage'; paths: string[] }
	| { type: 'discard'; paths: string[]; untracked?: boolean }
	| { type: 'commit'; message: string }
	| { type: 'openFile'; path: string }
	| { type: 'openDiff'; path: string; state: FileState; staged: boolean }
	| { type: 'resolve'; mode: ConflictMode; paths: string[] }
	| { type: 'abortMerge' }
	| { type: 'createBranch'; name: string; switchTo: boolean }
	| { type: 'switchBranch'; name: string }
	| { type: 'archiveBranch'; name: string }
	| { type: 'push' }
	| { type: 'pull' }
	| { type: 'compare'; source: string; target: string; requestId: number }
	| { type: 'openBranchDiff'; path: string; state: FileState; source: string; target: string }
	| { type: 'merge'; source: string; message?: string }
	| { type: 'createPullRequest'; source: string; target: string; title: string; description: string }
	| { type: 'healthCheck' }
	| { type: 'showOutput' };

// host -> webview
export type Message =
	| { type: 'state'; snapshot: Snapshot }
	| { type: 'compare'; requestId: number; result?: CompareResult; error?: string }
	| { type: 'committed' }
	| { type: 'toast'; level: 'info' | 'warn' | 'error'; text: string }
	| { type: 'navigate'; tab: TabId; source?: string };

export type TabId = 'changes' | 'history' | 'branches' | 'merge' | 'pr' | 'server';
