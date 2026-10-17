import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MongoClient, type Db, ObjectId } from 'mongodb';
import { ChatService } from '../src/chat/service.js';
import type { LlmClient, LlmResponse } from '../src/chat/types.js';
import type { ToolRouter, Principal } from '../src/router/tool-router.js';

class MockLlmClient implements LlmClient {
  public callCount = 0;
  public responses: LlmResponse[] = [];

  constructor(responses: LlmResponse[] = []) {
    this.responses = responses;
  }

  async generateResponse(_params: any): Promise<LlmResponse> {
    this.callCount++;
    if (this.responses.length > 0) {
      return this.responses.shift()!;
    }
    return { text: 'Default assistant response.' };
  }
}

class MockToolRouter {
  public tools = [
    {
      name: 'woo-mcp__wc_products_create',
      description: 'Create a new WooCommerce product',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    },
  ];
  public calls: Array<{ name: string; args: any }> = [];

  async list(_principal: Principal) {
    return this.tools;
  }

  async call(_principal: Principal, exposedName: string, args: Record<string, unknown>) {
    this.calls.push({ name: exposedName, args });
    return {
      content: [{ type: 'text', text: JSON.stringify({ id: 101, name: args.name, status: 'publish' }) }],
      isError: false,
    };
  }
}

describe('Chat Service & Agent Loop', () => {
  let mongoClient: MongoClient;
  let db: Db;
  let mockToolRouter: MockToolRouter;

  const mongoUri = process.env.TEST_MONGO_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  const testDbName = `conduit_chat_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  beforeEach(async () => {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db(testDbName);
    mockToolRouter = new MockToolRouter();
  });

  afterEach(async () => {
    if (db) {
      try {
        await db.dropDatabase();
      } catch {}
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  });

  it('executes a single-turn natural response and persists conversation and messages', async () => {
    const mockLlm = new MockLlmClient([
      { text: 'Hello! I am your Conduit assistant.' },
    ]);

    const service = new ChatService(db, mockToolRouter as unknown as ToolRouter, mockLlm);
    const userId = new ObjectId().toHexString();
    const textDeltas: string[] = [];

    await service.executeTurn({
      userId,
      userEmail: 'karan@conduit.localhost',
      userName: 'Karan',
      userRole: 'admin',
      message: 'Hello Conduit!',
      callbacks: {
        onTextDelta: (d) => textDeltas.push(d.delta),
      },
    });

    expect(textDeltas.join('')).toContain('Hello! I am your Conduit assistant.');

    const convs = await service.getConversations(userId);
    expect(convs).toHaveLength(1);
    expect(convs[0].title).toBe('Hello Conduit!');

    const convData = await service.getConversation(convs[0]._id.toHexString(), userId);
    expect(convData).not.toBeNull();
    expect(convData!.messages).toHaveLength(2);
    expect(convData!.messages[0].role).toBe('user');
    expect(convData!.messages[0].content).toBe('Hello Conduit!');
    expect(convData!.messages[1].role).toBe('assistant');
    expect(convData!.messages[1].content).toContain('Hello! I am your Conduit assistant.');
  });

  it('handles multi-step tool calls and returns final model response', async () => {
    const mockLlm = new MockLlmClient([
      {
        text: 'I will create the product for you.',
        toolCalls: [
          {
            id: 'tc_1',
            name: 'woo-mcp__wc_products_create',
            args: { name: 'Test Coffee Mug' },
          },
        ],
      },
      {
        text: 'Created product "Test Coffee Mug" with ID 101 successfully.',
      },
    ]);

    const service = new ChatService(db, mockToolRouter as unknown as ToolRouter, mockLlm);
    const userId = new ObjectId().toHexString();
    const toolCallsEmitted: any[] = [];
    const toolResultsEmitted: any[] = [];

    await service.executeTurn({
      userId,
      userEmail: 'karan@conduit.localhost',
      userName: 'Karan',
      userRole: 'admin',
      message: 'Create a coffee mug product',
      callbacks: {
        onToolCall: (tc) => toolCallsEmitted.push(tc),
        onToolResult: (tr) => toolResultsEmitted.push(tr),
      },
    });

    expect(mockToolRouter.calls).toHaveLength(1);
    expect(mockToolRouter.calls[0].name).toBe('woo-mcp__wc_products_create');
    expect(toolCallsEmitted).toHaveLength(1);
    expect(toolResultsEmitted).toHaveLength(1);
    expect(toolResultsEmitted[0].ok).toBe(true);

    const convs = await service.getConversations(userId);
    const convData = await service.getConversation(convs[0]._id.toHexString(), userId);
    const assistantMsg = convData!.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0].name).toBe('woo-mcp__wc_products_create');
    expect(assistantMsg!.content).toContain('Created product "Test Coffee Mug"');
  });

  it('detects 3 consecutive identical tool calls and stops infinite loops', async () => {
    const identicalCall = {
      id: 'tc_dup',
      name: 'woo-mcp__wc_products_create',
      args: { name: 'Infinite Mug' },
    };

    const mockLlm = new MockLlmClient([
      { text: 'Iteration 1', toolCalls: [identicalCall] },
      { text: 'Iteration 2', toolCalls: [identicalCall] },
      { text: 'Iteration 3', toolCalls: [identicalCall] },
      { text: 'Iteration 4', toolCalls: [identicalCall] },
    ]);

    const service = new ChatService(db, mockToolRouter as unknown as ToolRouter, mockLlm);
    const userId = new ObjectId().toHexString();

    await service.executeTurn({
      userId,
      userEmail: 'loop@conduit.localhost',
      userName: 'Looper',
      userRole: 'member',
      message: 'Test loop detection',
      callbacks: {},
    });

    // Should stop before exhausting all 8 iterations or continuing infinitely
    expect(mockLlm.callCount).toBeLessThanOrEqual(3);

    const convs = await service.getConversations(userId);
    const convData = await service.getConversation(convs[0]._id.toHexString(), userId);
    const assistantMsg = convData!.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg!.content).toContain('repeating the exact same tool calls');
  });

  it('enforces 1 active turn per user and returns 409 for concurrent turns', async () => {
    let resolveTurn!: () => void;
    const turnWaitPromise = new Promise<void>((r) => {
      resolveTurn = r;
    });

    const blockingLlm: LlmClient = {
      async generateResponse() {
        await turnWaitPromise;
        return { text: 'Done' };
      },
    };

    const service = new ChatService(db, mockToolRouter as unknown as ToolRouter, blockingLlm);
    const userId = new ObjectId().toHexString();

    // Start first turn (blocks)
    const turn1Promise = service.executeTurn({
      userId,
      userEmail: 'alice@conduit.localhost',
      userName: 'Alice',
      userRole: 'member',
      message: 'Turn 1',
      callbacks: {},
    });

    expect(service.isTurnInProgress(userId)).toBe(true);

    // Attempt second turn concurrently
    await expect(
      service.executeTurn({
        userId,
        userEmail: 'alice@conduit.localhost',
        userName: 'Alice',
        userRole: 'member',
        message: 'Turn 2 concurrent',
        callbacks: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'turn_in_progress',
    });

    // Unblock first turn
    resolveTurn();
    await turn1Promise;
    expect(service.isTurnInProgress(userId)).toBe(false);
  });

  it('enforces cross-user isolation: user cannot view or delete another users conversation', async () => {
    const mockLlm = new MockLlmClient([{ text: 'Private conversation content' }]);
    const service = new ChatService(db, mockToolRouter as unknown as ToolRouter, mockLlm);

    const userA = new ObjectId().toHexString();
    const userB = new ObjectId().toHexString();

    await service.executeTurn({
      userId: userA,
      userEmail: 'usera@conduit.localhost',
      userName: 'User A',
      userRole: 'member',
      message: 'User A secret message',
      callbacks: {},
    });

    const userAConvs = await service.getConversations(userA);
    const userAConvId = userAConvs[0]._id.toHexString();

    // User B tries to view User A's conversation
    const accessedByB = await service.getConversation(userAConvId, userB);
    expect(accessedByB).toBeNull();

    // User B tries to delete User A's conversation
    const deletedByB = await service.deleteConversation(userAConvId, userB);
    expect(deletedByB).toBe(false);

    // Verify User A's conversation still exists intact
    const verifiedA = await service.getConversation(userAConvId, userA);
    expect(verifiedA).not.toBeNull();
  });
});
