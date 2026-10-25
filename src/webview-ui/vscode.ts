import { Request } from '../shared/protocol';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function send(request: Request): void {
	api.postMessage(request);
}

export function loadUiState<T>(fallback: T): T {
	const state = api.getState();
	return state && typeof state === 'object' ? { ...fallback, ...(state as Partial<T>) } : fallback;
}

export function saveUiState(state: unknown): void {
	api.setState(state);
}
