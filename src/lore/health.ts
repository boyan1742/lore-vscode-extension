import * as http from 'http';
import { HealthInfo } from '../shared/protocol';
import { parseLoreUrl } from './parsers';

export interface HealthTarget {
	/** Full health URL override. */
	url?: string;
	/** `lore://host:port/repo` of the configured remote. */
	remoteUrl?: string;
	httpPort: number;
}

export function resolveHealthUrl(target: HealthTarget): string | undefined {
	if (target.url) {
		return target.url;
	}
	if (!target.remoteUrl) {
		return undefined;
	}
	const parsed = parseLoreUrl(target.remoteUrl);
	if (!parsed) {
		return undefined;
	}
	// The health endpoint is served over HTTP on its own port, not on the lore:// port.
	return `http://${parsed.host}:${target.httpPort}/health_check`;
}

export function checkHealth(target: HealthTarget, timeoutMs = 4000): Promise<HealthInfo> {
	const url = resolveHealthUrl(target);
	if (!url) {
		return Promise.resolve({ state: 'noRemote', checkedAt: Date.now() });
	}
	return new Promise(resolve => {
		const started = Date.now();
		const finish = (info: Omit<HealthInfo, 'url' | 'checkedAt'>) => resolve({ ...info, url, checkedAt: Date.now() });
		try {
			const req = http.get(url, { timeout: timeoutMs }, res => {
				res.resume();
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					finish({ state: 'ok', latencyMs: Date.now() - started });
				} else {
					finish({ state: 'down', error: `HTTP ${res.statusCode}` });
				}
			});
			req.on('timeout', () => {
				req.destroy();
				finish({ state: 'down', error: `No response within ${timeoutMs} ms` });
			});
			req.on('error', err => finish({ state: 'down', error: err.message }));
		} catch (err) {
			finish({ state: 'down', error: err instanceof Error ? err.message : String(err) });
		}
	});
}
