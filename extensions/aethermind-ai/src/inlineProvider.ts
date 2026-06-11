/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AetherMind Studio. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIService, CompletionRequest } from './aiService.js';
import { ConfigManager } from './config.js';

export class AetherMindInlineProvider implements vscode.InlineCompletionItemProvider {
	private aiService: AIService;
	private configManager: ConfigManager;
	private statusBarItem: vscode.StatusBarItem;
	private isEnabled: boolean = true;
	private debounceTimer: NodeJS.Timeout | undefined;
	private lastCompletionTime: number = 0;
	private readonly MIN_COMPLETION_INTERVAL = 500; // ms between completions

	constructor(configManager: ConfigManager) {
		this.configManager = configManager;
		this.aiService = new AIService({} as any); // Will be updated with actual config
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.statusBarItem.command = 'aethermind.toggleCompletion';
		this.statusBarItem.show();
		this.updateStatusBar();

		// Listen for config changes
		this.configManager.onDidChangeConfig(async () => {
			const config = await this.configManager.getConfig();
			this.aiService.updateConfig(config);
			this.isEnabled = config.enableInlineCompletion;
			this.updateStatusBar();
		});

		// Initialize with current config
		this.configManager.getConfig().then(config => {
			this.aiService.updateConfig(config);
			this.isEnabled = config.enableInlineCompletion;
		});
	}

	private updateStatusBar(): void {
		if (this.isEnabled) {
			this.statusBarItem.text = '$(sparkle-filled) AetherMind AI';
			this.statusBarItem.tooltip = 'AetherMind AI Inline Completion - Enabled';
			this.statusBarItem.backgroundColor = undefined;
		} else {
			this.statusBarItem.text = '$(sparkle) AetherMind AI';
			this.statusBarItem.tooltip = 'AetherMind AI Inline Completion - Disabled';
			this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		}
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionList | undefined> {
		// Check if enabled
		if (!this.isEnabled) {
			return undefined;
		}

		// Debounce rapid requests
		const now = Date.now();
		if (now - this.lastCompletionTime < this.MIN_COMPLETION_INTERVAL) {
			return undefined;
		}

		// Don't complete if cursor is at start of line or in certain contexts
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);
		
		// Skip if line is empty or only whitespace
		if (!textBeforeCursor.trim()) {
			return undefined;
		}

		// Skip if in comment or string (basic check)
		const languageId = document.languageId;
		if (this.shouldSkipCompletion(textBeforeCursor, languageId)) {
			return undefined;
		}

		// Clear previous debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Debounce with delay
		return new Promise((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				try {
					const completion = await this.getCompletion(document, position, token);
					this.lastCompletionTime = Date.now();
					
					if (completion && token.isCancellationRequested) {
						resolve(undefined);
						return;
					}

					if (completion) {
						const inlineItem = new vscode.InlineCompletionItem(
							completion,
							new vscode.Range(position, position)
						);
						resolve(new vscode.InlineCompletionList([inlineItem]));
					} else {
						resolve(undefined);
					}
				} catch (error) {
					// Silently fail on errors to not interrupt typing
					if (error instanceof Error && !token.isCancellationRequested) {
						vscode.window.showErrorMessage(`AetherMind AI: ${error.message}`);
					}
					resolve(undefined);
				}
			}, 300); // 300ms debounce delay
		});
	}

	private shouldSkipCompletion(textBeforeCursor: string, languageId: string): boolean {
		// Skip if in comment (basic detection)
		const commentPatterns: { [key: string]: RegExp[] } = {
			javascript: [/(\/\/.*$)/, /(\/\*.*\*\/)/],
			typescript: [/(\/\/.*$)/, /(\/\*.*\*\/)/],
			python: [/(#.*)/],
			cpp: [/(\/\/.*$)/, /(\/\*.*\*\/)/],
			c: [/(\/\/.*$)/, /(\/\*.*\*\/)/],
			java: [/(\/\/.*$)/, /(\/\*.*\*\/)/],
			go: [/(\/\/.*$)/],
			rust: [/(\/\/.*$)/],
			php: [/(\/\/.*$)/, /(\/\*.*\*\/)/, /(#.*)/],
			ruby: [/(#.*)/],
			shell: [/(#.*)/],
			powershell: [/(#.*)/],
			sql: [/(--.*)/],
			html: [/<!--.*-->/],
			css: [/\/\*.*\*\//]
		};

		const patterns = commentPatterns[languageId] || commentPatterns.javascript;
		for (const pattern of patterns) {
			if (pattern.test(textBeforeCursor)) {
				return true;
			}
		}

		return false;
	}

	private async getCompletion(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<string | undefined> {
		const config = await this.configManager.getConfig();
		
		if (!config.apiKey) {
			// Don't show error on every keystroke, just return undefined
			return undefined;
		}

		// Get text before cursor
		const range = new vscode.Range(new vscode.Position(0, 0), position);
		const prefix = document.getText(range);

		// Get text after cursor (for context)
		const endPosition = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
		const suffixRange = new vscode.Range(position, endPosition);
		const suffix = document.getText(suffixRange);

		// Get open file names for context
		const openFiles = vscode.workspace.textDocuments
			.map(doc => doc.uri.fsPath)
			.filter(path => path !== document.uri.fsPath)
			.map(path => path.split(/[/\\]/).pop() || path);

		const request: CompletionRequest = {
			prefix,
			suffix,
			filePath: document.uri.fsPath,
			language: document.languageId,
			openFiles
		};

		try {
			const response = await this.aiService.getCompletion(request, token);
			return response.completion;
		} catch (error) {
			if (error instanceof Error) {
				// Only show error if it's not a cancellation
				if (!token.isCancellationRequested) {
					vscode.window.showErrorMessage(`AetherMind AI: ${error.message}`);
				}
			}
			return undefined;
		}
	}

	toggle(): void {
		this.isEnabled = !this.isEnabled;
		this.updateStatusBar();
		vscode.window.showInformationMessage(
			`AetherMind AI ${this.isEnabled ? 'enabled' : 'disabled'}`
		);
	}

	dispose(): void {
		this.statusBarItem.dispose();
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
	}
}
