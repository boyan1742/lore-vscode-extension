import * as assert from 'assert';
import { buildGraph } from '../lore/graph';
import { parseHistory } from '../lore/parsers';
import * as f from './fixtures';

suite('graph', () => {
	const build = (limit = 100) => buildGraph({
		histories: [parseHistory(f.HISTORY_MAIN), parseHistory(f.HISTORY_FEAT)],
		branchNames: new Map([
			['e726318bbc3fd75ac8733a7e030cc35b', 'main'],
			['01a1725a8a957093b6a0ca36e5d11a58', 'feat'],
		]),
		tips: new Map([['1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3', ['main']]]),
		headSignature: '1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3',
		limit,
	});

	test('unions branches by signature, not revision number', () => {
		const g = build();
		// 4 distinct revisions even though main and feat both have a "revision 2".
		assert.strictEqual(g.rows.length, 4);
		assert.strictEqual(new Set(g.rows.map(r => r.signature)).size, 4);
	});

	test('children come before parents', () => {
		const g = build();
		const rowOf = new Map(g.rows.map((r, i) => [r.signature, i]));
		for (const r of g.rows) {
			for (const p of r.parents) {
				assert.ok((rowOf.get(p) ?? Infinity) > rowOf.get(r.signature)!);
			}
		}
		assert.ok(g.rows[0].isMerge && g.rows[0].isHead);
		assert.deepStrictEqual(g.rows[0].refs, ['main']);
	});

	test('the merged branch gets its own lane and edges end on real rows', () => {
		const g = build();
		assert.ok(g.columns >= 2);
		const feat = g.rows.find(r => r.message === 'feat edit')!;
		const main = g.rows.find(r => r.message === 'main edit')!;
		assert.notStrictEqual(feat.col, main.col);
		assert.strictEqual(g.edges.length, 4); // merge->2 parents, main edit->base, feat edit->base
		for (const e of g.edges) {
			assert.ok(e.toRow > e.fromRow);
		}
	});

	test('a window cuts edges at the bottom and flags truncation', () => {
		const g = build(2);
		assert.strictEqual(g.rows.length, 2);
		assert.ok(g.truncated);
		assert.ok(g.edges.some(e => e.toRow === g.rows.length));
	});
});
