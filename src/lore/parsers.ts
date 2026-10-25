import { BranchEntry, FileChange, FileState, RepoInfo, RepoStatus, SyncState } from '../shared/protocol';
import { splitLines } from './cli';

const ZERO_HASH = /^0+$/;

export function isZeroHash(hash: string): boolean {
	return ZERO_HASH.test(hash);
}

function toState(letter: string): FileState {
	switch (letter) {
		case 'A': case 'M': case 'D': case 'R': case 'C':
			return letter;
		default:
			return 'M';
	}
}

/**
 * Parses one file line as printed by `status` / `branch diff`:
 *   "A a.txt", "A a.txt ", "M  a.txt (M)!", "C sp ace.txt"
 * A trailing "!" marks a conflict; a trailing "(X)" is secondary info we drop.
 */
export function parseFileLine(line: string): FileChange | undefined {
	const match = /^([A-Z])\s+(.+?)\s*$/.exec(line);
	if (!match) {
		return undefined;
	}
	let path = match[2];
	let conflict = false;
	if (path.endsWith('!')) {
		conflict = true;
		path = path.slice(0, -1).trimEnd();
	}
	path = path.replace(/\s+\([A-Z]\)$/, '');
	return { path, state: toState(match[1]), ...(conflict ? { conflict } : {}) };
}

export function parseStatus(text: string): RepoStatus {
	const status: RepoStatus = {
		repositoryId: '',
		branch: '',
		revision: 0,
		signature: '',
		sync: 'unknown',
		staged: [],
		unstaged: [],
		untracked: [],
		conflicts: [],
	};
	let section: 'staged' | 'unstaged' | 'untracked' | 'conflicts' | undefined;

	for (const raw of splitLines(text)) {
		const line = raw.trimEnd();
		if (!line) {
			continue;
		}
		let m: RegExpExecArray | null;
		if ((m = /^Repository (\S+)/.exec(line))) {
			status.repositoryId = m[1];
		} else if ((m = /^On branch (.+?) revision (\d+) -> (\w+)/.exec(line))) {
			status.branch = m[1];
			status.revision = Number(m[2]);
			status.signature = m[3];
			section = undefined;
		} else if ((m = /^Remote revision (\d+) -> (\w+)/.exec(line))) {
			status.remoteRevision = Number(m[1]);
			status.remoteSignature = m[2];
		} else if (/^Remote branch does not exist/.test(line)) {
			status.sync = 'noRemoteBranch';
			status.syncText = line;
		} else if (/^Local branch/.test(line)) {
			status.syncText = line;
			status.sync = classifySync(line);
		} else if ((m = /^Pending merge, incoming revision (\w+)/.exec(line))) {
			status.pendingMerge = m[1];
		} else if (/^Changes staged for commit:/.test(line)) {
			section = 'staged';
		} else if (/^Changes not staged for commit:/.test(line)) {
			section = 'unstaged';
		} else if (/^Untracked files:/.test(line)) {
			section = 'untracked';
		} else if (/^Changes in conflict:/.test(line)) {
			section = 'conflicts';
		} else if (/^(Tracked changes:|No tracked changes)/.test(line)) {
			section = undefined;
		} else if (section) {
			const change = parseFileLine(line);
			if (change) {
				status[section].push(section === 'conflicts' ? { ...change, conflict: true } : change);
			}
		}
	}
	return status;
}

function classifySync(line: string): SyncState {
	const l = line.toLowerCase();
	if (l.includes('diverge')) {
		return 'diverged';
	}
	if (l.includes('ahead')) {
		return 'ahead';
	}
	if (l.includes('behind')) {
		return 'behind';
	}
	if (l.includes('in sync')) {
		return 'inSync';
	}
	return 'unknown';
}

export interface BranchList {
	entries: BranchEntry[];
	remoteReachable: boolean;
}

/** Parses `branch list --archived`. */
export function parseBranchList(text: string): BranchList {
	const byName = new Map<string, BranchEntry>();
	let section: 'local' | 'archived' | 'remote' | undefined;
	let remoteReachable = true;
	const get = (name: string): BranchEntry => {
		let entry = byName.get(name);
		if (!entry) {
			entry = { name, current: false, local: false, remote: false, archived: false };
			byName.set(name, entry);
		}
		return entry;
	};

	for (const raw of splitLines(text)) {
		const line = raw.trimEnd();
		if (!line.trim()) {
			continue;
		}
		if (/^Local branches:/.test(line)) {
			section = 'local';
		} else if (/^Archived local branches:/.test(line)) {
			section = 'archived';
		} else if (/^Remote branches:/.test(line)) {
			section = 'remote';
		} else if (/^Warning:.*remote/i.test(line)) {
			remoteReachable = false;
		} else if (section && /^[*\s]\s/.test(line)) {
			const current = line.startsWith('*');
			const entry = get(line.slice(2).trim());
			if (section === 'local') {
				entry.local = true;
				entry.current = current;
			} else if (section === 'archived') {
				entry.archived = true;
			} else {
				entry.remote = true;
			}
		}
	}
	return { entries: [...byName.values()], remoteReachable };
}

export function parseBranchInfo(text: string): { id?: string; latest?: string } {
	const id = /^\s*ID:\s*(\w+)/m.exec(text)?.[1];
	const latest = /^\s*Latest:\s*(\w+)/m.exec(text)?.[1];
	return { id, latest };
}

export interface HistoryEntry {
	revision: number;
	signature: string;
	parents: string[]; // explicit "Parent" lines (parent lives on another branch)
	mergeParent?: string;
	branchId: string;
	date: string;
	message: string;
	creator: string;
	committer: string;
	merger?: string;
}

/** Parses the multi-line blocks printed by `history`. */
export function parseHistory(text: string): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	let current: HistoryEntry | undefined;
	let message: string[] = [];

	const flush = () => {
		if (current) {
			current.message = message.join('\n').trim();
			entries.push(current);
		}
		message = [];
	};

	for (const raw of splitLines(text)) {
		if (/^\s/.test(raw) && raw.trim()) {
			message.push(raw.replace(/^ {1,4}/, ''));
			continue;
		}
		const m = /^(\w+)\s*:\s*(.*)$/.exec(raw);
		if (!m) {
			if (!raw.trim() && message.length) {
				message.push('');
			}
			continue;
		}
		const [, key, value] = m;
		if (key === 'Revision') {
			flush();
			current = { revision: Number(value), signature: '', parents: [], branchId: '', date: '', message: '', creator: '', committer: '' };
			continue;
		}
		if (!current) {
			continue;
		}
		switch (key) {
			case 'Signature': current.signature = value.trim(); break;
			case 'Parent': current.parents.push(value.trim()); break;
			case 'Merge': current.mergeParent = value.trim(); break;
			case 'Branch': current.branchId = value.trim(); break;
			case 'Date': current.date = value.trim(); break;
			case 'Creator': current.creator = value.trim(); break;
			case 'Committer': current.committer = value.trim(); break;
			case 'Merger': current.merger = value.trim(); break;
		}
	}
	flush();
	return entries.filter(e => e.signature);
}

export interface BranchDiff {
	changes: FileChange[];
	conflicts: string[];
}

/** Parses `branch diff`: "Found N changes" + file lines, then optional "Found N conflicts" + "C path" lines. */
export function parseBranchDiff(text: string): BranchDiff {
	const changes: FileChange[] = [];
	const conflicts: string[] = [];
	let section: 'changes' | 'conflicts' | undefined;
	for (const raw of splitLines(text)) {
		const line = raw.trimEnd();
		if (/^Found \d+ changes?/.test(line)) {
			section = 'changes';
		} else if (/^Found \d+ conflicts?/.test(line)) {
			section = 'conflicts';
		} else if (section) {
			const change = parseFileLine(line);
			if (!change) {
				continue;
			}
			if (section === 'conflicts') {
				conflicts.push(change.path);
			} else {
				changes.push(change);
			}
		}
	}
	return { changes, conflicts };
}

export type MergeOutcome =
	| { kind: 'committed'; signature?: string }
	| { kind: 'conflicted'; files: string[] }
	| { kind: 'staged' }; // merged but not committed (e.g. --no-commit)

export function parseMergeOutput(text: string): MergeOutcome {
	const lines = splitLines(text);
	const conflictAt = lines.findIndex(l => /^Files in conflict:/.test(l));
	if (conflictAt >= 0) {
		const files = lines.slice(conflictAt + 1).map(l => l.trim()).filter(Boolean);
		return { kind: 'conflicted', files };
	}
	for (const line of lines) {
		const m = /^Committed merged repository state \d+ -> (\w+)/.exec(line);
		if (m) {
			return { kind: 'committed', signature: m[1] };
		}
	}
	return { kind: 'staged' };
}

export function parseRepositoryInfo(text: string): RepoInfo {
	const info: RepoInfo = {};
	const head = /^(.+?) \((\w+)\)\s*$/m.exec(text);
	if (head) {
		info.name = head[1];
		info.id = head[2];
	}
	info.remoteUrl = /^Remote URL:\s*(\S+)/m.exec(text)?.[1];
	info.defaultBranch = /^Default branch:\s*(.+?) \(/m.exec(text)?.[1];
	info.creator = /^Creator:\s*(.+)$/m.exec(text)?.[1]?.trim();
	info.created = /^Created:\s*(.+)$/m.exec(text)?.[1]?.trim();
	return info;
}

/** Extracts host from a `lore://host:port/repo` URL. */
export function parseLoreUrl(url: string): { host: string; port?: number } | undefined {
	const m = /^lore:\/\/(\[[^\]]+\]|[^/:]+)(?::(\d+))?/.exec(url.trim());
	if (!m) {
		return undefined;
	}
	return { host: m[1], port: m[2] ? Number(m[2]) : undefined };
}

export function hasConflictMarkers(content: string): boolean {
	return /^<{7}( |$)/m.test(content) && /^>{7}( |$)/m.test(content);
}
