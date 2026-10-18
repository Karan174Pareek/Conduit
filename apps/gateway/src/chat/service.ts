import { ObjectId, type Db, type Collection } from 'mongodb';
import type { ToolRouter, Principal } from '../router/tool-router.js';
import type { LlmClient, LlmTurnMessage, LlmFunctionDeclaration, LlmToolResult } from './types.js';
import { renderSystemPrompt, wrapToolResultEnvelope } from './prompt-renderer.js';
import { sanitizeToolSchema } from './schema-sanitizer.js';

export interface ChatTurnCallbacks {
  onTurnStart?: (data: { conversationId: string; turnId: string }) => void;
  onTextDelta?: (data: { delta: string }) => void;
  onToolCall?: (data: { id: string; server: string; tool: string; args: Record<string, unknown> }) => void;
  onToolResult?: (data: { id: string; server: string; tool: string; ok: boolean; durationMs: number; summary: string }) => void;
  onConfirmRequired?: (data: { id: string; server: string; tool: string; args: Record<string, unknown>; summary: string }) => void;
  onError?: (data: { code: string; message: string }) => void;
  onDone?: (data: { turnId: string; usage?: { inputTokens?: number; outputTokens?: number } }) => void;
}

export interface ConversationDoc {
  _id: ObjectId;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageDoc {
  _id: ObjectId;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    durationMs: number;
    summary: string;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  interrupted?: boolean;
  createdAt: Date;
}

export class ChatService {
  private activeTurns = new Set<string>(); // userId

  constructor(
    private db: Db,
    private toolRouter: ToolRouter,
    private llmClient: LlmClient,
    private timezone = 'Asia/Kolkata',
    private orgName = 'Conduit Team',
  ) {}

  public isTurnInProgress(userId: string): boolean {
    return this.activeTurns.has(userId);
  }

  private get conversations(): Collection<ConversationDoc> {
    return this.db.collection<ConversationDoc>('conversations');
  }

  private get messages(): Collection<MessageDoc> {
    return this.db.collection<MessageDoc>('messages');
  }

  public async getConversations(userId: string): Promise<ConversationDoc[]> {
    return this.conversations
      .find({ userId })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  public async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<{ conversation: ConversationDoc; messages: MessageDoc[] } | null> {
    if (!ObjectId.isValid(conversationId)) return null;

    const conversation = await this.conversations.findOne({
      _id: new ObjectId(conversationId),
      userId,
    });
    if (!conversation) return null;

    const messages = await this.messages
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .toArray();

    return { conversation, messages };
  }

  public async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
    if (!ObjectId.isValid(conversationId)) return false;

    const res = await this.conversations.deleteOne({
      _id: new ObjectId(conversationId),
      userId,
    });
    if (res.deletedCount === 0) return false;

    await this.messages.deleteMany({ conversationId, userId });
    return true;
  }

  public async executeTurn(params: {
    userId: string;
    userEmail: string;
    userName: string;
    userRole: string;
    conversationId?: string;
    message: string;
    confirmedToolCalls?: string[];
    signal?: AbortSignal;
    callbacks: ChatTurnCallbacks;
  }): Promise<void> {
    const { userId, userEmail, userName, userRole, message, confirmedToolCalls, signal, callbacks } = params;

    // Concurrency check: One active turn per user
    if (this.activeTurns.has(userId)) {
      const err = new Error('Another chat turn is already in progress for this user');
      (err as any).statusCode = 409;
      (err as any).code = 'turn_in_progress';
      throw err;
    }

    this.activeTurns.add(userId);
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let convIdStr = params.conversationId;
    const assistantMessageId = new ObjectId();
    let accumulatedAssistantText = '';
    const storedToolCallRecords: NonNullable<MessageDoc['toolCalls']> = [];

    try {
      // 1. Resolve or create conversation
      if (!convIdStr || !ObjectId.isValid(convIdStr)) {
        const title = message.trim().slice(0, 60) || 'New Conversation';
        const newConvId = new ObjectId();
        await this.conversations.insertOne({
          _id: newConvId,
          userId,
          title,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        convIdStr = newConvId.toHexString();
      } else {
        const existing = await this.conversations.findOne({
          _id: new ObjectId(convIdStr),
          userId,
        });
        if (!existing) {
          const err = new Error('Conversation not found');
          (err as any).statusCode = 404;
          throw err;
        }
        await this.conversations.updateOne(
          { _id: new ObjectId(convIdStr) },
          { $set: { updatedAt: new Date() } },
        );
      }

      callbacks.onTurnStart?.({ conversationId: convIdStr, turnId });

      // 2. Persist user message
      await this.messages.insertOne({
        _id: new ObjectId(),
        conversationId: convIdStr,
        userId,
        role: 'user',
        content: message,
        createdAt: new Date(),
      });

      // 3. Load historical messages for context
      const historyDocs = await this.messages
        .find({ conversationId: convIdStr })
        .sort({ createdAt: 1 })
        .toArray();

      // Convert history to LlmTurnMessage format
      const llmMessages: LlmTurnMessage[] = historyDocs.map((doc) => {
        if (doc.role === 'user') {
          return { role: 'user', content: doc.content };
        } else if (doc.role === 'assistant') {
          return {
            role: 'model',
            content: doc.content,
            toolCalls: doc.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
          };
        }
        return { role: 'user', content: doc.content };
      });

      // 4. Retrieve available tools for this user via ToolRouter
      const chatPrincipal: Principal = {
        userId,
        email: userEmail,
        role: (userRole === 'admin' ? 'admin' : 'member'),
        via: 'session',
        source: 'chat',
      };

      const availableTools = await this.toolRouter.list(chatPrincipal);
      const functionDeclarations: LlmFunctionDeclaration[] = availableTools.map((t: { name: string; description: string; inputSchema?: Record<string, unknown> }) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: sanitizeToolSchema(t.inputSchema),
      }));

      // Render system prompt per turn
      const systemPrompt = renderSystemPrompt({
        orgName: this.orgName,
        userName,
        userRole,
        nowIso: new Date().toISOString(),
        timezone: this.timezone,
      });

      // 5. Turn Execution Loop
      const MAX_ITERATIONS = 8;
      const TURN_DEADLINE_MS = 90_000;
      const MAX_PARALLEL_TOOLS = 4;
      const turnStartTime = Date.now();

      let consecutiveIdenticalCallsCount = 0;
      let lastCallSignatures = '';
      let iteration = 0;
      const totalUsage = { inputTokens: 0, outputTokens: 0 };

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        // Deadline guard
        if (Date.now() - turnStartTime > TURN_DEADLINE_MS) {
          accumulatedAssistantText += '\n[Turn timed out after 90 seconds]';
          callbacks.onError?.({
            code: 'turn_timeout',
            message: 'Chat turn exceeded the 90-second execution deadline.',
          });
          break;
        }

        // Abort guard
        if (signal?.aborted) {
          break;
        }

        // Call LLM
        const llmResponse = await this.llmClient.generateResponse({
          systemPrompt,
          messages: llmMessages,
          tools: functionDeclarations.length > 0 ? functionDeclarations : undefined,
          signal,
        });

        if (llmResponse.usage) {
          totalUsage.inputTokens += llmResponse.usage.inputTokens ?? 0;
          totalUsage.outputTokens += llmResponse.usage.outputTokens ?? 0;
        }

        if (llmResponse.text) {
          accumulatedAssistantText += (accumulatedAssistantText ? '\n' : '') + llmResponse.text;
          callbacks.onTextDelta?.({ delta: llmResponse.text });
        }

        // Check if tool calls were requested
        const toolCalls = llmResponse.toolCalls;
        if (!toolCalls || toolCalls.length === 0) {
          // Model finished turn with natural text
          break;
        }

        // Detect 3 consecutive identical tool calls
        const currentSignatures = toolCalls
          .map((tc) => `${tc.name}:${JSON.stringify(tc.args)}`)
          .sort()
          .join('|');

        if (currentSignatures === lastCallSignatures) {
          consecutiveIdenticalCallsCount++;
          if (consecutiveIdenticalCallsCount >= 2) {
            // 3rd time
            const loopExpl =
              '\nI noticed I was repeating the exact same tool calls multiple times without making progress, so I stopped to avoid an infinite loop.';
            accumulatedAssistantText += loopExpl;
            callbacks.onTextDelta?.({ delta: loopExpl });
            break;
          }
        } else {
          consecutiveIdenticalCallsCount = 0;
          lastCallSignatures = currentSignatures;
        }

        // Add assistant's response to conversation history before executing tools
        llmMessages.push({
          role: 'model',
          content: llmResponse.text,
          toolCalls,
        });

        // Cap parallel tool calls to 4
        const callsToExecute = toolCalls.slice(0, MAX_PARALLEL_TOOLS);
        const toolResults: LlmToolResult[] = [];

        for (const tc of callsToExecute) {
          const parts = tc.name.split('__');
          const serverSlug = parts[0] || 'unknown';
          const toolName = parts.length > 1 ? parts.slice(1).join('__') : tc.name;

          callbacks.onToolCall?.({
            id: tc.id,
            server: serverSlug,
            tool: toolName,
            args: tc.args,
          });

          // Destructive tool confirmation gate
          const confirmDestructive = process.env.CHAT_CONFIRM_DESTRUCTIVE === 'true';
          if (confirmDestructive && !confirmedToolCalls?.includes(tc.id)) {
            const catalogItem = await this.db.collection('tool_catalog').findOne({
              exposedName: tc.name,
              removedAt: null,
            });
            if (catalogItem?.annotations?.destructiveHint === true) {
              const summary = `Action requires confirmation: ${tc.name}`;
              callbacks.onConfirmRequired?.({
                id: tc.id,
                server: serverSlug,
                tool: toolName,
                args: tc.args,
                summary,
              });
              return;
            }
          }

          const toolStart = Date.now();
          let rawOutputStr = '';
          let isError = false;

          try {
            // Call via ToolRouter with authenticated chat principal
            const callRes = await this.toolRouter.call(chatPrincipal, tc.name, tc.args, { deadlineMs: 30_000 });
            if (callRes.isError) {
              isError = true;
            }
            rawOutputStr = callRes.content?.[0]?.text ?? JSON.stringify(callRes);
          } catch (err: any) {
            isError = true;
            rawOutputStr = `[gateway:internal_error] ${err.message}`;
          }

          const durationMs = Date.now() - toolStart;
          const { wrapped, summary } = wrapToolResultEnvelope(serverSlug, toolName, rawOutputStr, isError);

          callbacks.onToolResult?.({
            id: tc.id,
            server: serverSlug,
            tool: toolName,
            ok: !isError,
            durationMs,
            summary,
          });

          storedToolCallRecords.push({
            id: tc.id,
            name: tc.name,
            args: tc.args,
            ok: !isError,
            durationMs,
            summary,
          });

          toolResults.push({
            id: tc.id,
            name: tc.name,
            result: wrapped,
            isError,
          });
        }

        // Append tool results to model context
        llmMessages.push({
          role: 'user',
          content: '',
          toolResults,
        });
      }

      // 6. Persist assistant message
      await this.messages.insertOne({
        _id: assistantMessageId,
        conversationId: convIdStr,
        userId,
        role: 'assistant',
        content: accumulatedAssistantText,
        toolCalls: storedToolCallRecords.length > 0 ? storedToolCallRecords : undefined,
        usage: totalUsage,
        interrupted: signal?.aborted === true,
        createdAt: new Date(),
      });

      callbacks.onDone?.({ turnId, usage: totalUsage });
    } catch (err: any) {
      // If turn was aborted or failed, save partial message if text/tools existed
      if (accumulatedAssistantText || storedToolCallRecords.length > 0) {
        try {
          await this.messages.insertOne({
            _id: assistantMessageId,
            conversationId: convIdStr ?? '',
            userId,
            role: 'assistant',
            content: accumulatedAssistantText,
            toolCalls: storedToolCallRecords.length > 0 ? storedToolCallRecords : undefined,
            interrupted: true,
            createdAt: new Date(),
          });
        } catch (_e) {
          void _e;
        }
      }

      callbacks.onError?.({
        code: err.code || 'internal_error',
        message: err.message,
      });
      throw err;
    } finally {
      this.activeTurns.delete(userId);
    }
  }
}
