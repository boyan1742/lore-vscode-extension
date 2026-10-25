import { Snapshot } from '../shared/protocol';
import { Section } from './common';
import { send } from './vscode';

const LABEL = { unknown: 'Not checked', checking: 'Checking…', ok: 'Healthy', down: 'Unreachable', noRemote: 'No remote configured' } as const;

export function Server({ snapshot }: { snapshot: Snapshot }) {
	const { health, repoInfo, status } = snapshot;
	return (
		<div className="stack">
			<Section title="Server health" actions={<button className="btn btn-small" onClick={() => send({ type: 'healthCheck' })} disabled={health.state === 'checking'}>Check now</button>}>
				<div className="health-line">
					<span className={`dot dot-${health.state}`} />
					<strong>{LABEL[health.state]}</strong>
					{health.state === 'ok' && health.latencyMs !== undefined && <span className="hint">{health.latencyMs} ms</span>}
				</div>
				<dl className="detail">
					{health.url && <><dt>Endpoint</dt><dd className="mono">{health.url}</dd></>}
					{health.error && <><dt>Error</dt><dd className="error-text">{health.error}</dd></>}
					{health.checkedAt && <><dt>Last check</dt><dd>{new Date(health.checkedAt).toLocaleTimeString()}</dd></>}
				</dl>
				{health.state === 'down' && (
					<div className="hint">The health endpoint is served over HTTP (default port 41339), separate from the lore:// port. Change it with the lore.healthCheck.port setting.</div>
				)}
			</Section>

			<Section title="Repository">
				<dl className="detail">
					<dt>Name</dt><dd>{repoInfo?.name ?? '—'}</dd>
					<dt>ID</dt><dd className="mono">{repoInfo?.id ?? status?.repositoryId ?? '—'}</dd>
					<dt>Remote</dt><dd className="mono">{repoInfo?.remoteUrl ?? 'none (offline repository)'}</dd>
					<dt>Default branch</dt><dd>{repoInfo?.defaultBranch ?? '—'}</dd>
					<dt>Creator</dt><dd>{repoInfo?.creator ?? '—'}</dd>
					<dt>Sync</dt><dd>{status?.syncText ?? '—'}</dd>
					<dt>Identity</dt><dd>{snapshot.identityConfigured ? 'from lore.identity setting' : 'from .lore/config.toml'}</dd>
				</dl>
				<div className="actions">
					<button className="btn btn-secondary btn-small" onClick={() => send({ type: 'showOutput' })}>Show command log</button>
				</div>
			</Section>
		</div>
	);
}
