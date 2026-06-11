/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AetherMind Studio. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AetherMindConfig } from './config.js';

export interface CompletionRequest {
	prefix: string;
	suffix: string;
	filePath: string;
	language: string;
	openFiles: string[];
}

export interface CompletionResponse {
	completion: string;
	finishReason: string;
}

export class AIService {
	private config: AetherMindConfig;

	constructor(config: AetherMindConfig) {
		this.config = config;
	}

	updateConfig(config: AetherMindConfig): void {
		this.config = config;
	}

	async getCompletion(request: CompletionRequest, cancellationToken?: vscode.CancellationToken): Promise<CompletionResponse> {
		if (!this.config.apiKey) {
			throw new Error('API key not configured. Please set your Anthropic API key in settings.');
		}

		if (!this.config.enableInlineCompletion) {
			throw new Error('Inline completion is disabled in settings.');
		}

		const prompt = this.buildPrompt(request);
		
		try {
			const response = await this.makeApiRequest(prompt, cancellationToken);
			return response;
		} catch (error) {
			if (cancellationToken?.isCancellationRequested) {
				throw new Error('Request cancelled');
			}
			throw error;
		}
	}

	private buildPrompt(request: CompletionRequest): string {
		const { prefix, suffix, filePath, language, openFiles } = request;

		let context = `You are an AI coding assistant for ${language}. Complete the code naturally and concisely.\n\n`;
		
		if (openFiles.length > 0) {
			context += `Currently open files: ${openFiles.join(', ')}\n`;
			context += `Current file: ${filePath}\n\n`;
		}

		context += `Complete the following code:\n\`\`\`${language}\n${prefix}`;
		
		if (suffix) {
			context += `\n[Cursor here]\n${suffix}`;
		}
		
		context += `\n\`\`\`\n\nProvide only the completion text, no explanations or markdown formatting.`;

		return context;
	}

	private async makeApiRequest(prompt: string, cancellationToken?: vscode.CancellationToken): Promise<CompletionResponse> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

		if (cancellationToken) {
			cancellationToken.onCancellationRequested(() => {
				controller.abort();
			});
		}

		try {
			const response = await fetch(this.config.apiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.config.apiKey,
					'anthropic-version': '2023-06-01',
					'anthropic-dangerous-direct-browser-access': 'true'
				},
				body: JSON.stringify({
					model: this.config.model,
					max_tokens: this.config.maxTokens,
					messages: [
						{
							role: 'user',
							content: prompt
						}
					],
					stream: true,
					temperature: this.config.temperature
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
				
				if (response.status === 401) {
					errorMessage = 'Invalid API key. Please check your Anthropic API key in settings.';
				} else if (response.status === 429) {
					errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
				} else if (response.status === 500) {
					errorMessage = 'Anthropic API server error. Please try again later.';
				}
				
				throw new Error(errorMessage);
			}

			// Read streaming response
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body reader available');
			}

			const decoder = new TextDecoder();
			let accumulatedText = '';
			let finishReason = 'stop';

			while (true) {
				// Check for cancellation
				if (cancellationToken?.isCancellationRequested) {
					reader.cancel();
					throw new Error('Request cancelled');
				}

				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				// Decode the chunk
				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6).trim();
						
						if (data === '[DONE]') {
							continue;
						}

						try {
							const event = JSON.parse(data);
							
							// Handle content_block_delta events (streaming text)
							if (event.type === 'content_block_delta' && event.delta?.text) {
								accumulatedText += event.delta.text;
							}
							
							// Handle message_stop event
							if (event.type === 'message_stop') {
								finishReason = event.stop_reason || 'stop';
							}
							
							// Handle error events
							if (event.type === 'error') {
								throw new Error(`API error: ${event.error?.message || 'Unknown error'}`);
							}
						} catch (parseError) {
							// Skip invalid JSON lines
							continue;
						}
					}
				}
			}

			return {
				completion: accumulatedText,
				finishReason
			};

		} catch (error) {
			clearTimeout(timeoutId);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError') {
					throw new Error('Request cancelled or timed out');
				}
				throw error;
			}
			
			throw new Error('Unknown error occurred during API request');
		}
	}
}
