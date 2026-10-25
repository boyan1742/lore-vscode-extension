import { useState } from 'react';
import { GraphData, GraphEdge } from '../shared/protocol';
import { Empty, shortSig, timeAgo } from './common';

const ROW_H = 30;
const COL_W = 16;
const PAD = 10;

const cx = (col: number) => PAD + col * COL_W;
const cy = (row: number) => ROW_H * row + ROW_H / 2;

function edgePath(e: GraphEdge, rowCount: number): string {
	const x1 = cx(e.fromCol);
	const y1 = cy(e.fromRow);
	const xl = cx(e.lane);
	const x2 = cx(e.toCol);
	const dangling = e.toRow >= rowCount;
	const y2 = dangling ? ROW_H * rowCount : cy(e.toRow);
	const H = ROW_H;
	if (dangling) {
		return x1 === xl
			? `M${x1} ${y1} L${xl} ${y2}`
			: `M${x1} ${y1} C${x1} ${y1 + H / 2} ${xl} ${y1 + H / 2} ${xl} ${y1 + H} L${xl} ${y2}`;
	}
	if (e.toRow - e.fromRow <= 1) {
		const ym = (y1 + y2) / 2;
		return x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
	}
	let d = `M${x1} ${y1}`;
	d += x1 === xl ? ` L${xl} ${y1 + H}` : ` C${x1} ${y1 + H / 2} ${xl} ${y1 + H / 2} ${xl} ${y1 + H}`;
	d += ` L${xl} ${y2 - H}`;
	d += x2 === xl ? ` L${x2} ${y2}` : ` C${xl} ${y2 - H / 2} ${x2} ${y2 - H / 2} ${x2} ${y2}`;
	return d;
}

const colorVar = (n: number) => `var(--lore-c${n % 8})`;

export interface GraphProps {
	graph?: GraphData;
	currentBranch?: string;
	onRefClick?: (branch: string) => void;
	compact?: boolean;
}

export function Graph({ graph, currentBranch, onRefClick, compact }: GraphProps) {
	const [selected, setSelected] = useState<string>();
	if (!graph) {
		return <Empty>Loading history…</Empty>;
	}
	if (!graph.rows.length) {
		return <Empty>No revisions yet. Stage files and commit to create the first one.</Empty>;
	}
	const width = PAD * 2 + Math.max(0, graph.columns - 1) * COL_W;
	const height = graph.rows.length * ROW_H;
	const selectedRow = graph.rows.find(r => r.signature === selected);

	return (
		<div className="graph" role="list" style={{ ['--graph-w' as string]: `${width}px` }}>
			<svg className="graph-svg" width={width} height={height} aria-hidden="true">
				{graph.edges.map((e, i) => (
					<path key={i} d={edgePath(e, graph.rows.length)} fill="none" strokeWidth={2} style={{ stroke: colorVar(e.color) }} />
				))}
				{graph.rows.map((r, i) => (
					<g key={r.signature}>
						{r.isHead && <circle cx={cx(r.col)} cy={cy(i)} r={8} fill="none" strokeWidth={1.5} style={{ stroke: 'var(--vscode-focusBorder)' }} />}
						<circle cx={cx(r.col)} cy={cy(i)} r={r.isMerge ? 5 : 4} strokeWidth={2}
							style={{ stroke: colorVar(r.color), fill: r.isMerge ? 'var(--vscode-editor-background)' : colorVar(r.color) }} />
					</g>
				))}
			</svg>
			{graph.rows.map(r => {
				const open = selected === r.signature;
				return (
					<div key={r.signature} role="listitem" className={`graph-row${open ? ' open' : ''}`}
						onClick={() => setSelected(open ? undefined : r.signature)}>
						<div className="graph-line" style={{ height: ROW_H }}>
							{r.refs.map(ref => (
								<button key={ref} className={`ref${ref === currentBranch ? ' ref-current' : ''}`}
									title={ref === currentBranch ? 'Current branch' : `Merge ${ref}…`}
									onClick={e => { e.stopPropagation(); if (ref !== currentBranch) { onRefClick?.(ref); } }}>
									{ref}
								</button>
							))}
							<span className="graph-msg">{r.message.split('\n')[0] || '(no message)'}</span>
							<span className="spacer" />
							{!compact && <span className="graph-author">{r.author}</span>}
							<span className="graph-time">{timeAgo(r.date)}</span>
						</div>
					</div>
				);
			})}
			{selectedRow && (
				<dl className="detail">
					<dt>Revision</dt><dd>{selectedRow.revision} on {selectedRow.branchName}</dd>
					<dt>Signature</dt><dd className="mono">{selectedRow.signature}</dd>
					{selectedRow.parents.length > 0 && <><dt>Parents</dt><dd className="mono">{selectedRow.parents.map(shortSig).join(', ')}</dd></>}
					<dt>Author</dt><dd>{selectedRow.author}</dd>
					<dt>Date</dt><dd>{selectedRow.date}</dd>
					{selectedRow.message.includes('\n') && <><dt>Message</dt><dd className="pre">{selectedRow.message}</dd></>}
				</dl>
			)}
			{graph.truncated && <div className="hint">Older revisions are not shown (see lore.graph.maxRevisions).</div>}
		</div>
	);
}
