/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AetherMind Studio. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigManager } from './config.js';
import { AetherMindInlineProvider } from './inlineProvider.js';

let inlineProvider: AetherMindInlineProvider | undefined;
let configManager: ConfigManager | undefined;
let providerRegistration: vscode.Disposable | undefined;

export async function activate(context: vscode.ExtensionContext) {
	console.log('AetherMind AI extension is activating...');

	// Initialize config manager with secret storage
	configManager = new ConfigManager(context.secrets);

	// Initialize inline completion provider
	inlineProvider = new AetherMindInlineProvider(configManager);

	// Register the inline completion provider for all file types
	providerRegistration = vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: '**' },
		inlineProvider
	);

	// Register commands
	const toggleCommand = vscode.commands.registerCommand(
		'aethermind.toggleCompletion',
		() => {
			if (inlineProvider) {
				inlineProvider.toggle();
			}
		}
	);

	const setApiKeyCommand = vscode.commands.registerCommand(
		'aethermind.setApiKey',
		async () => {
			const apiKey = await vscode.window.showInputBox({
				prompt: 'Enter your Anthropic API key',
				password: true,
				placeHolder: 'sk-ant-...'
			});

			if (apiKey && configManager) {
				await configManager.setApiKey(apiKey);
				vscode.window.showInformationMessage('API key saved securely');
			}
		}
	);

	// Add disposables to context
	context.subscriptions.push(
		providerRegistration,
		toggleCommand,
		setApiKeyCommand,
		inlineProvider,
		configManager
	);

	console.log('AetherMind AI extension activated successfully');
}

export function deactivate() {
	if (providerRegistration) {
		providerRegistration.dispose();
	}
	if (inlineProvider) {
		inlineProvider.dispose();
	}
	if (configManager) {
		configManager.dispose();
	}
	console.log('AetherMind AI extension deactivated');
}
