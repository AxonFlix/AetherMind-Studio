/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AetherMind Studio. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface AetherMindConfig {
	apiKey: string;
	model: string;
	apiEndpoint: string;
	maxTokens: number;
	enableInlineCompletion: boolean;
	temperature: number;
	timeout: number;
}

const CONFIG_SECTION = 'aethermind';
const SECRET_STORAGE_KEY = 'aethermind.apiKey';

export class ConfigManager {
	private config: vscode.WorkspaceConfiguration;
	private secretStorage: vscode.SecretStorage;
	private disposables: vscode.Disposable[] = [];
	private _onDidChangeConfig = new vscode.EventEmitter<void>();
	public readonly onDidChangeConfig = this._onDidChangeConfig.event;

	constructor(secretStorage: vscode.SecretStorage) {
		this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		this.secretStorage = secretStorage;
		this.setupConfigListener();
	}

	private setupConfigListener(): void {
		const listener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CONFIG_SECTION)) {
				this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
				this._onDidChangeConfig.fire();
			}
		});
		this.disposables.push(listener);
	}

	async getApiKey(): Promise<string> {
		// First check secret storage
		const secretKey = await this.secretStorage.get(SECRET_STORAGE_KEY);
		if (secretKey) {
			return secretKey;
		}

		// Fallback to config (for backward compatibility)
		const configKey = this.config.get<string>('apiKey', '');
		if (configKey) {
			// Migrate to secret storage
			await this.setApiKey(configKey);
			// Clear from config
			await this.config.update('apiKey', '', vscode.ConfigurationTarget.Global);
			return configKey;
		}

		return '';
	}

	async setApiKey(apiKey: string): Promise<void> {
		if (apiKey) {
			await this.secretStorage.store(SECRET_STORAGE_KEY, apiKey);
		} else {
			await this.secretStorage.delete(SECRET_STORAGE_KEY);
		}
	}

	async getConfig(): Promise<AetherMindConfig> {
		const apiKey = await this.getApiKey();
		return {
			apiKey,
			model: this.config.get<string>('model', 'claude-3-5-sonnet-20241022'),
			apiEndpoint: this.config.get<string>('apiEndpoint', 'https://api.anthropic.com/v1/messages'),
			maxTokens: this.config.get<number>('maxTokens', 256),
			enableInlineCompletion: this.config.get<boolean>('enableInlineCompletion', true),
			temperature: this.config.get<number>('temperature', 0.7),
			timeout: this.config.get<number>('timeout', 30000)
		};
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeConfig.dispose();
	}
}
