import { execFile } from 'child_process';

export interface CliConfig {
	executable: string;
	identity: string;
}

export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class LoreError extends Error {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly stdout: string,
		readonly stderr: string,
		readonly args: string[],
	) {
		super(message);
		this.name = 'LoreError';
	}
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI, '');
}

export function splitLines(text: string): string[] {
	return stripAnsi(text).split(/\r?\n/);
}

/** Picks the most useful single line out of a failed invocation. */
export function summarizeFailure(stdout: string, stderr: string): string {
	const lines = [...splitLines(stderr), ...splitLines(stdout)].map(l => l.trim()).filter(Boolean);
	const marked = lines.find(l => l.startsWith('[Error]'));
	if (marked) {
		return marked.replace(/^\[Error\]\s*/, '');
	}
	return lines.find(l => !l.startsWith('at ')) ?? 'lore exited with an error';
}

export type OutputSink = (line: string) => void;

/**
 * Runs the `lore` executable with an argument array (never through a shell).
 * Calls are serialized: lore takes locks on the repository, and interleaving
 * stage/commit/switch calls from the UI would race.
 */
export class LoreCli {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		readonly cwd: string,
		private readonly config: () => CliConfig,
		private readonly log: OutputSink = () => undefined,
	) { }

	run(args: string[], options: { timeoutMs?: number; okExitCodes?: number[] } = {}): Promise<CliResult> {
		const task = this.queue.then(() => this.exec(args, options));
		this.queue = task.catch(() => undefined);
		return task;
	}

	private exec(args: string[], options: { timeoutMs?: number; okExitCodes?: number[] }): Promise<CliResult> {
		const { executable, identity } = this.config();
		// -P: never page (the Windows pager blocks without a TTY); --non-interactive: never prompt.
		const full = ['-P', '--non-interactive', ...(identity ? ['--identity', identity] : []), ...args];
		this.log(`> lore ${args.map(quoteForLog).join(' ')}`);

		return new Promise((resolve, reject) => {
			const child = execFile(executable || 'lore', full, {
				cwd: this.cwd,
				encoding: 'utf8',
				windowsHide: true,
				maxBuffer: 64 * 1024 * 1024,
				timeout: options.timeoutMs ?? 10 * 60 * 1000,
				env: { ...process.env, NO_COLOR: '1' },
			}, (error, stdout, stderr) => {
				const out = stripAnsi(stdout ?? '');
				const err = stripAnsi(stderr ?? '');
				for (const line of [...splitLines(out), ...splitLines(err)]) {
					if (line.trim()) {
						this.log(`  ${line}`);
					}
				}
				const spawnFailed = error && (error as NodeJS.ErrnoException).code === 'ENOENT';
				if (spawnFailed) {
					reject(new LoreError(`Could not run "${executable || 'lore'}". Install the Lore CLI or set "lore.path".`, null, out, err, args));
					return;
				}
				const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
				const ok = exitCode === 0 || (options.okExitCodes ?? []).includes(exitCode);
				if (!ok) {
					reject(new LoreError(summarizeFailure(out, err), exitCode, out, err, args));
					return;
				}
				resolve({ stdout: out, stderr: err, exitCode });
			});
			child.stdin?.end();
		});
	}
}

function quoteForLog(arg: string): string {
	return /[\s"]/.test(arg) ? JSON.stringify(arg) : arg;
}
