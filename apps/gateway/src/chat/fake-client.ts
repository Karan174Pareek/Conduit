import type { LlmClient, LlmTurnMessage, LlmFunctionDeclaration, LlmResponse } from './types.js';

export class FakeLlmClient implements LlmClient {
  public responses: LlmResponse[] = [];
  public callsMade: Array<{
    systemPrompt: string;
    messages: LlmTurnMessage[];
    tools?: LlmFunctionDeclaration[];
  }> = [];

  constructor(nodeEnv = process.env['NODE_ENV']) {
    if (nodeEnv === 'production') {
      throw new Error('FakeLlmClient is strictly prohibited when NODE_ENV=production');
    }
  }

  public queueResponse(resp: LlmResponse): void {
    this.responses.push(resp);
  }

  public clear(): void {
    this.responses = [];
    this.callsMade = [];
  }

  async generateResponse(params: {
    systemPrompt: string;
    messages: LlmTurnMessage[];
    tools?: LlmFunctionDeclaration[];
    signal?: AbortSignal;
  }): Promise<LlmResponse> {
    if (params.signal?.aborted) {
      throw new Error('AbortError: LLM call aborted by client');
    }

    this.callsMade.push({
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      tools: params.tools,
    });

    if (this.responses.length > 0) {
      return this.responses.shift()!;
    }

    return {
      text: 'I am ready to help you with your store and tools.',
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
}
