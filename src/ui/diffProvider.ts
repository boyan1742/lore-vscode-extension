import * as vscode from 'vscode';
import { FileState } from '../shared/protocol';
import { LoreService } from '../lore/service';

export const LORE_SCHEME = 'lore';

/** Serves file contents at a given revision signature: lore:/<path>?sig=<signature>. An empty signature means "no file". */
export class LoreContentProvider implements vscode.TextDocumentContentProvider {
	constructor(private readonly getService: () => LoreService | undefined) { }

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const service = this.getService();
		const sig = new URLSearchParams(uri.query).get('sig') ?? '';
		if (!service || !sig) {
			return '';
		}
		return service.fileAtRevision(uri.path.replace(/^\//, ''), sig);
	}
}

export function revisionUri(filePath: string, signature: string | undefined): vscode.Uri {
	return vscode.Uri.from({ scheme: LORE_SCHEME, path: `/${filePath}`, query: `sig=${signature ?? ''}` });
}

/** Opens VS Code's diff editor for a working-tree change against the current revision. */
export async function openWorkingDiff(service: LoreService, filePath: string, state: FileState): Promise<void> {
	const head = service.currentStatus?.signature;
	const working = vscode.Uri.joinPath(vscode.Uri.file(service.root), filePath);
	const left = revisionUri(filePath, state === 'A' ? undefined : head);
	const right = state === 'D' ? revisionUri(filePath, undefined) : working;
	await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (Lore: revision ↔ working tree)`);
}

/** Opens a diff of one file between two branch tips (used by pull request / merge previews). */
export async function openBranchDiff(
	service: LoreService, filePath: string, state: FileState, source: string, target: string,
): Promise<void> {
	const tip = (name: string) => service.branchEntries.find(b => b.name === name)?.latest;
	const left = revisionUri(filePath, state === 'A' ? undefined : tip(target));
	const right = revisionUri(filePath, state === 'D' ? undefined : tip(source));
	await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (${target} ↔ ${source})`);
}
