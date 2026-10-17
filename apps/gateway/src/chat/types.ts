export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  name: string;
  result: Record<string, unknown> | string;
  isError?: boolean;
}

export interface LlmTurnMessage {
  role: 'user' | 'model';
  content?: string;
  toolCalls?: LlmToolCall[];
  toolResults?: LlmToolResult[];
}

export interface LlmFunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface LlmResponse {
  text?: string;
  toolCalls?: LlmToolCall[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LlmClient {
  generateResponse(params: {
    systemPrompt: string;
    messages: LlmTurnMessage[];
    tools?: LlmFunctionDeclaration[];
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}
