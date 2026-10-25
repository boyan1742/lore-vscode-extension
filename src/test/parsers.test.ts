import * as assert from 'assert';
import { stripAnsi, summarizeFailure } from '../lore/cli';
import {
	hasConflictMarkers, parseBranchDiff, parseBranchInfo, parseBranchList, parseFileLine, parseHistory,
	parseLoreUrl, parseMergeOutput, parseRepositoryInfo, parseStatus,
} from '../lore/parsers';
import { resolveHealthUrl } from '../lore/health';
import * as f from './fixtures';

suite('parsers', () => {
	test('status: clean, in sync', () => {
		const s = parseStatus(f.STATUS_CLEAN);
		assert.strictEqual(s.branch, 'main');
		assert.strictEqual(s.revision, 1);
		assert.strictEqual(s.sync, 'inSync');
		assert.strictEqual(s.remoteRevision, 1);
		assert.deepStrictEqual([s.staged.length, s.unstaged.length, s.untracked.length, s.conflicts.length], [0, 0, 0, 0]);
	});

	test('status: sections, trailing spaces and paths with spaces', () => {
		const s = parseStatus(f.STATUS_DIRTY);
		assert.deepStrictEqual(s.staged, [{ path: 'b.txt', state: 'A' }]);
		assert.deepStrictEqual(s.unstaged, [{ path: 'a.txt', state: 'M' }, { path: 'sp ace.txt', state: 'D' }]);
		assert.deepStrictEqual(s.untracked, [{ path: 'c.txt', state: 'A' }]);
		assert.strictEqual(s.sync, 'unknown');
	});

	test('status: pending merge with conflicts', () => {
		const s = parseStatus(f.STATUS_MERGING);
		assert.strictEqual(s.sync, 'ahead');
		assert.ok(s.pendingMerge?.startsWith('c9aa8da4'));
		assert.deepStrictEqual(s.staged, [{ path: 'f.txt', state: 'A' }]);
		assert.deepStrictEqual(s.conflicts, [{ path: 'a.txt', state: 'M', conflict: true }]);
	});

	test('status: branch not on the remote', () => {
		assert.strictEqual(parseStatus(f.STATUS_NO_REMOTE_BRANCH).sync, 'noRemoteBranch');
	});

	test('file lines', () => {
		assert.deepStrictEqual(parseFileLine('M  a.txt (M)!'), { path: 'a.txt', state: 'M', conflict: true });
		assert.deepStrictEqual(parseFileLine('A dir/sp ace.txt '), { path: 'dir/sp ace.txt', state: 'A' });
		assert.strictEqual(parseFileLine('Tracked changes: 2 added'), undefined);
	});

	test('branch list with remote and archived branches', () => {
		const { entries, remoteReachable } = parseBranchList(f.BRANCH_LIST_REMOTE);
		assert.ok(remoteReachable);
		const by = Object.fromEntries(entries.map(e => [e.name, e]));
		assert.ok(by.main.current && by.main.local && by.main.remote);
		assert.ok(by.feat.local && !by.feat.current && !by.feat.remote);
		assert.ok(by['old-work'].archived && !by['old-work'].local);
	});

	test('branch list offline', () => {
		const { entries, remoteReachable } = parseBranchList(f.BRANCH_LIST_OFFLINE);
		assert.strictEqual(remoteReachable, false);
		assert.deepStrictEqual(entries.map(e => e.name), ['main']);
	});

	test('branch info', () => {
		const info = parseBranchInfo(f.BRANCH_INFO);
		assert.strictEqual(info.id, 'e726318bbc3fd75ac8733a7e030cc35b');
		assert.ok(info.latest?.startsWith('226032c9'));
	});

	test('history blocks, merge parent and explicit parent', () => {
		const main = parseHistory(f.HISTORY_MAIN);
		assert.deepStrictEqual(main.map(e => e.revision), [3, 2, 1]);
		assert.ok(main[0].mergeParent?.startsWith('c9aa8da4'));
		assert.strictEqual(main[0].message, 'merge feat into main');
		assert.strictEqual(main[0].merger, 'tester');
		const feat = parseHistory(f.HISTORY_FEAT);
		assert.strictEqual(feat[0].parents.length, 1);
		assert.notStrictEqual(feat[0].branchId, feat[1].branchId);
	});

	test('history keeps multi-line messages', () => {
		const text = `Revision  : 4
Signature : aa
Branch    : b1
Date      : Sun, 25 Oct 2026 09:18:24 +0000
    title

    body line
Creator   : me
Committer : me
`;
		assert.strictEqual(parseHistory(text)[0].message, 'title\n\nbody line');
	});

	test('branch diff: changes and conflicts', () => {
		const clean = parseBranchDiff(f.BRANCH_DIFF_CLEAN);
		assert.deepStrictEqual(clean.changes.map(c => `${c.state} ${c.path}`), ['M a.txt', 'D f.txt', 'A g.txt', 'A sp ace.txt']);
		assert.deepStrictEqual(clean.conflicts, []);
		const conflict = parseBranchDiff(f.BRANCH_DIFF_CONFLICT);
		assert.deepStrictEqual(conflict.changes, []);
		assert.deepStrictEqual(conflict.conflicts, ['a.txt']);
	});

	test('merge output distinguishes committed from conflicted', () => {
		const clean = parseMergeOutput(f.MERGE_CLEAN);
		assert.strictEqual(clean.kind, 'committed');
		assert.ok(clean.kind === 'committed' && clean.signature?.startsWith('b94cb3c5'));
		assert.deepStrictEqual(parseMergeOutput(f.MERGE_CONFLICT), { kind: 'conflicted', files: ['a.txt'] });
	});

	test('repository info and lore urls', () => {
		const info = parseRepositoryInfo(f.REPO_INFO);
		assert.strictEqual(info.name, 'demo2');
		assert.strictEqual(info.remoteUrl, 'lore://127.0.0.1:41337');
		assert.strictEqual(info.defaultBranch, 'main');
		assert.deepStrictEqual(parseLoreUrl('lore://example.com:41337/repo'), { host: 'example.com', port: 41337 });
		assert.strictEqual(parseLoreUrl('http://x'), undefined);
	});

	test('health url uses the http port, not the lore port', () => {
		assert.strictEqual(resolveHealthUrl({ remoteUrl: 'lore://127.0.0.1:41337/demo', httpPort: 41339 }), 'http://127.0.0.1:41339/health_check');
		assert.strictEqual(resolveHealthUrl({ remoteUrl: undefined, httpPort: 41339 }), undefined);
		assert.strictEqual(resolveHealthUrl({ url: 'http://h/x', remoteUrl: 'lore://a', httpPort: 1 }), 'http://h/x');
	});

	test('conflict marker detection (diff3)', () => {
		assert.ok(hasConflictMarkers('a\n<<<<<<< ours\nx\n||||||| original\ny\n=======\nz\n>>>>>>> theirs\n'));
		assert.ok(!hasConflictMarkers('plain\n'));
	});

	test('cli helpers', () => {
		assert.strictEqual(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
		assert.strictEqual(summarizeFailure('', '[Error] No merge is in progress\n  at merge.rs:1'), 'No merge is in progress');
	});
});
