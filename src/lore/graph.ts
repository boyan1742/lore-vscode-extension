import { GraphData, GraphEdge, GraphRow } from '../shared/protocol';
import { HistoryEntry } from './parsers';

export interface GraphInput {
	/** One list per branch walked, newest first (the order `lore history` prints). */
	histories: HistoryEntry[][];
	branchNames: Map<string, string>; // branch id -> name
	tips: Map<string, string[]>; // signature -> branch names whose latest is that revision
	headSignature?: string;
	limit: number;
}

interface Node {
	entry: HistoryEntry;
	parents: string[];
	time: number;
}

const PALETTE_SIZE = 8;

function hashColor(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) {
		h = (h * 31 + id.charCodeAt(i)) >>> 0;
	}
	return h % PALETTE_SIZE;
}

/**
 * Builds a git-style lane layout from per-branch histories.
 *
 * Nodes are keyed by signature (revision numbers repeat across branches).
 * `history` prints a branch newest-first and omits "Parent" when the parent is the next
 * entry on the same branch, so the first parent is either the explicit Parent line or the
 * following entry; the second parent of a merge is the "Merge" line.
 */
export function buildGraph(input: GraphInput): GraphData {
	const nodes = new Map<string, Node>();

	for (const list of input.histories) {
		list.forEach((entry, i) => {
			if (nodes.has(entry.signature)) {
				return;
			}
			const parents = entry.parents.length ? [...entry.parents] : (list[i + 1] ? [list[i + 1].signature] : []);
			if (entry.mergeParent && !parents.includes(entry.mergeParent)) {
				parents.push(entry.mergeParent);
			}
			nodes.set(entry.signature, { entry, parents, time: Date.parse(entry.date) || 0 });
		});
	}

	// Children-before-parents order; among ready nodes the newest goes first.
	const childCount = new Map<string, number>();
	for (const node of nodes.values()) {
		for (const p of node.parents) {
			if (nodes.has(p)) {
				childCount.set(p, (childCount.get(p) ?? 0) + 1);
			}
		}
	}
	const ready = [...nodes.values()].filter(n => !childCount.get(n.entry.signature));
	const ordered: Node[] = [];
	while (ready.length) {
		ready.sort((a, b) => b.time - a.time || b.entry.revision - a.entry.revision);
		const next = ready.shift()!;
		ordered.push(next);
		for (const p of next.parents) {
			const left = childCount.get(p);
			if (left === undefined) {
				continue;
			}
			if (left <= 1) {
				childCount.delete(p);
				ready.push(nodes.get(p)!);
			} else {
				childCount.set(p, left - 1);
			}
		}
	}

	const truncated = ordered.length > input.limit;
	const window = ordered.slice(0, input.limit);
	const rowOf = new Map(window.map((n, i) => [n.entry.signature, i]));

	const lanes: (string | null)[] = [];
	const rows: GraphRow[] = [];
	const pending: { fromRow: number; fromCol: number; lane: number; parent: string; color: number }[] = [];

	const freeLane = (): number => {
		const free = lanes.indexOf(null);
		if (free >= 0) {
			return free;
		}
		lanes.push(null);
		return lanes.length - 1;
	};

	window.forEach((node, rowIndex) => {
		const sig = node.entry.signature;
		let col = lanes.indexOf(sig);
		if (col < 0) {
			col = freeLane();
		}
		// Other lanes waiting for this node end here.
		lanes.forEach((s, i) => {
			if (s === sig && i !== col) {
				lanes[i] = null;
			}
		});
		lanes[col] = null;

		const color = hashColor(node.entry.branchId);
		node.parents.forEach((parent, idx) => {
			let lane = lanes.indexOf(parent);
			if (lane < 0) {
				lane = idx === 0 ? col : freeLane();
				lanes[lane] = parent;
			}
			pending.push({ fromRow: rowIndex, fromCol: col, lane, parent, color });
		});

		rows.push({
			signature: sig,
			revision: node.entry.revision,
			message: node.entry.message,
			author: node.entry.merger ?? node.entry.creator,
			date: node.entry.date,
			branchId: node.entry.branchId,
			branchName: input.branchNames.get(node.entry.branchId) ?? node.entry.branchId.slice(0, 8),
			refs: input.tips.get(sig) ?? [],
			parents: node.parents,
			col,
			color,
			isMerge: node.parents.length > 1,
			isHead: sig === input.headSignature,
		});
	});

	const edges: GraphEdge[] = pending.map(p => {
		const toRow = rowOf.get(p.parent) ?? rows.length;
		const toCol = toRow < rows.length ? rows[toRow].col : p.lane;
		return { fromRow: p.fromRow, toRow, fromCol: p.fromCol, lane: p.lane, toCol, color: p.color };
	});

	const columns = Math.max(1, ...rows.map(r => r.col + 1), ...edges.map(e => e.lane + 1));
	return { rows, edges, columns, truncated };
}
