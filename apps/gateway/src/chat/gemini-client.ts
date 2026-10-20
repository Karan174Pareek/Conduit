import { GoogleGenAI } from '@google/genai';
import type { LlmClient, LlmTurnMessage, LlmFunctionDeclaration, LlmResponse, LlmToolCall } from './types.js';

export class GeminiLlmClient implements LlmClient {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = 'gemini-3.8-flash') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required to initialize GeminiLlmClient');
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(params: {
    systemPrompt: string;
    messages: LlmTurnMessage[];
    tools?: LlmFunctionDeclaration[];
    signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const { systemPrompt, messages, tools, signal } = params;

    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content ?? '' }],
        });
      } else if (msg.role === 'model') {
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.args,
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
      }

      if (msg.toolResults && msg.toolResults.length > 0) {
        const resultParts: any[] = [];
        for (const tr of msg.toolResults) {
          resultParts.push({
            functionResponse: {
              name: tr.name,
              response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { output: String(tr.result) },
            },
          });
        }
        contents.push({ role: 'user', parts: resultParts });
      }
    }

    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parametersJsonSchema: t.parametersJsonSchema,
    }));

    const config: any = {
      systemInstruction: systemPrompt,
    };

    if (functionDeclarations && functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    let attempt = 0;
    const maxAttempts = 4;

    while (attempt < maxAttempts) {
      if (signal?.aborted) {
        throw new Error('AbortError: LLM call was aborted');
      }

      try {
        const res = await this.client.models.generateContent({
          model: this.model,
          contents,
          config,
        });

        const candidate = res.candidates?.[0];
        let text: string | undefined;
        const toolCalls: LlmToolCall[] = [];

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              text = (text ? text + '\n' : '') + part.text;
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                name: part.functionCall.name ?? '',
                args: (part.functionCall.args as Record<string, unknown>) ?? {},
              });
            }
          }
        }

        return {
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: {
            inputTokens: res.usageMetadata?.promptTokenCount,
            outputTokens: res.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err: any) {
        attempt++;
        const status = err.status || err.statusCode;
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (attempt >= maxAttempts || !isRetryable || signal?.aborted) {
          throw err;
        }

        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
      }
    }

    throw new Error('Gemini API request failed after retries');
  }
}
