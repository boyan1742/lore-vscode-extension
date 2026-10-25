import * as vscode from 'vscode';
import { Request } from '../shared/protocol';
import { Controller } from './controller';

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, layout: 'sidebar' | 'panel'): string {
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'lore.css'));
	const token = nonce();
	const csp = [
		"default-src 'none'",
		`style-src ${webview.cspSource}`,
		`script-src 'nonce-${token}'`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} data:`,
	].join('; ');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${style}" rel="stylesheet">
<title>Lore</title>
</head>
<body data-layout="${layout}">
<div id="root"></div>
<script nonce="${token}" src="${script}"></script>
</body>
</html>`;
}

function wire(controller: Controller, webview: vscode.Webview, disposables: vscode.Disposable[]): void {
	disposables.push(webview.onDidReceiveMessage((request: Request) => { void controller.handle(request, webview); }));
}

/** The compact view in the activity bar. */
export class SidebarProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'lore.actions';

	constructor(private readonly extensionUri: vscode.Uri, private readonly controller: Controller) { }

	resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
		view.webview.html = renderHtml(view.webview, this.extensionUri, 'sidebar');
		const disposables: vscode.Disposable[] = [];
		wire(this.controller, view.webview, disposables);
		disposables.push(this.controller.register({ webview: view.webview }));
		view.onDidDispose(() => disposables.forEach(d => d.dispose()));
	}
}

/** The full-size editor-area panel; one instance at a time. */
export class PanelManager implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;

	constructor(private readonly extensionUri: vscode.Uri, private readonly controller: Controller) { }

	open(): vscode.WebviewPanel {
		if (this.panel) {
			this.panel.reveal();
			return this.panel;
		}
		const panel = vscode.window.createWebviewPanel('lore.panel', 'Lore', vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [this.extensionUri],
		});
		panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'lore.svg');
		panel.webview.html = renderHtml(panel.webview, this.extensionUri, 'panel');
		const disposables: vscode.Disposable[] = [];
		wire(this.controller, panel.webview, disposables);
		disposables.push(this.controller.register({ webview: panel.webview }));
		panel.onDidDispose(() => {
			disposables.forEach(d => d.dispose());
			this.panel = undefined;
		});
		this.panel = panel;
		return panel;
	}

	dispose(): void {
		this.panel?.dispose();
	}
}
