import * as vscode from 'vscode';
import { Controller } from './ui/controller';
import { LORE_SCHEME, LoreContentProvider } from './ui/diffProvider';
import { PanelManager, SidebarProvider } from './ui/webviews';

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Lore');
	const controller = new Controller(context, output);
	const panels = new PanelManager(context.extensionUri, controller);

	const requireRepo = () => {
		const service = controller.currentService;
		if (!service?.snapshot().isRepo) {
			void vscode.window.showWarningMessage('This folder is not a Lore repository.');
			return undefined;
		}
		return service;
	};

	context.subscriptions.push(
		output,
		controller,
		panels,
		vscode.workspace.registerTextDocumentContentProvider(LORE_SCHEME, new LoreContentProvider(() => controller.currentService)),
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, new SidebarProvider(context.extensionUri, controller), {
			webviewOptions: { retainContextWhenHidden: true },
		}),

		vscode.commands.registerCommand('lore.openPanel', () => { panels.open(); }),
		vscode.commands.registerCommand('lore.refresh', async () => {
			await controller.currentService?.refresh({ scan: true, graph: true });
		}),
		vscode.commands.registerCommand('lore.showOutput', () => output.show(true)),
		vscode.commands.registerCommand('lore.healthCheck', async () => {
			const service = requireRepo();
			if (!service) {
				return;
			}
			await service.checkHealth();
			const health = service.snapshot().health;
			if (health.state === 'ok') {
				void vscode.window.showInformationMessage(`Lore server is healthy (${health.latencyMs} ms) at ${health.url}`);
			} else if (health.state === 'noRemote') {
				void vscode.window.showWarningMessage('This repository has no remote configured.');
			} else {
				void vscode.window.showErrorMessage(`Lore server is unreachable${health.url ? ` at ${health.url}` : ''}: ${health.error ?? 'no response'}`);
			}
		}),
		vscode.commands.registerCommand('lore.initRepository', async () => {
			const service = controller.currentService;
			if (!service) {
				void vscode.window.showWarningMessage('Open a folder first.');
				return;
			}
			const remote = await vscode.window.showInputBox({
				title: 'Initialize Lore repository',
				prompt: 'Remote URL (e.g. lore://127.0.0.1:41337/my-project). Leave empty for an offline repository.',
				ignoreFocusOut: true,
			});
			if (remote === undefined) {
				return;
			}
			try {
				await service.operation('Creating repository', () => service.init(remote.trim() || undefined, undefined));
			} catch (err) {
				controller.reportError(err);
			}
		}),
		vscode.commands.registerCommand('lore.createBranch', async () => {
			const service = requireRepo();
			const name = service && await vscode.window.showInputBox({ title: 'Create Lore branch', prompt: 'Branch name', ignoreFocusOut: true });
			if (!service || !name?.trim()) {
				return;
			}
			try {
				await service.operation('Creating branch', () => service.createBranch(name.trim(), true));
			} catch (err) {
				controller.reportError(err);
			}
		}),
		vscode.commands.registerCommand('lore.switchBranch', async () => {
			const service = requireRepo();
			if (!service) {
				return;
			}
			const items = service.branchEntries
				.filter(b => b.local && !b.archived)
				.map(b => ({ label: b.name, description: b.current ? 'current' : undefined }));
			const pick = await vscode.window.showQuickPick(items, { title: 'Switch Lore branch' });
			if (!pick || pick.description === 'current') {
				return;
			}
			try {
				await service.operation(`Switching to ${pick.label}`, () => service.switchBranch(pick.label));
			} catch (err) {
				controller.reportError(err);
			}
		}),
		vscode.commands.registerCommand('lore.push', async () => {
			const service = requireRepo();
			if (!service) {
				return;
			}
			try {
				const text = await service.operation('Pushing', () => service.push());
				void vscode.window.setStatusBarMessage(`Lore: ${text ?? 'pushed'}`, 4000);
			} catch (err) {
				controller.reportError(err);
			}
		}),
		vscode.commands.registerCommand('lore.pull', async () => {
			const service = requireRepo();
			if (!service) {
				return;
			}
			try {
				const text = await service.operation('Pulling', () => service.pull());
				void vscode.window.setStatusBarMessage(`Lore: ${text ?? 'pulled'}`, 4000);
			} catch (err) {
				controller.reportError(err);
			}
		}),
		vscode.commands.registerCommand('lore.createPullRequest', () => {
			panels.open();
			controller.navigate('pr');
		}),
	);
}

export function deactivate() { }
