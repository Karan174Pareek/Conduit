import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getCsrfToken } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ToolCallRecord {
  id: string;
  name?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  durationMs?: number;
  summary?: string;
  status?: 'running' | 'success' | 'error';
}

interface MessageItem {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt?: string;
}

interface ConversationDetail {
  conversation: ConversationSummary;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCallRecord[];
    createdAt: string;
  }>;
}

export const ChatPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Fetch conversations list
  const { data: conversations = [], isLoading: isLoadingConvs } = useQuery<ConversationSummary[]>({
    queryKey: ['conversations'],
    queryFn: () => apiClient.get('/api/conversations'),
  });

  // 2. Fetch conversation detail when activeConvId changes
  const { data: convDetail, isLoading: isLoadingDetail } = useQuery<ConversationDetail>({
    queryKey: ['conversation', activeConvId],
    queryFn: () => apiClient.get(`/api/conversations/${activeConvId}`),
    enabled: !!activeConvId,
  });

  // Sync messages from convDetail when loaded
  useEffect(() => {
    if (convDetail && !isStreaming) {
      setMessages(
        convDetail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          createdAt: m.createdAt,
        })),
      );
    }
  }, [convDetail, isStreaming]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Delete conversation mutation
  const deleteConvMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/conversations/${id}`),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (activeConvId === deletedId) {
        setActiveConvId(null);
        setMessages([]);
      }
      addToast('Conversation deleted', 'success');
    },
    onError: () => {
      addToast('Failed to delete conversation', 'error');
    },
  });

  const toggleToolExpanded = (id: string) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleStartNewChat = () => {
    if (isStreaming) {
      addToast('Turn in progress. Please stop or wait before starting a new chat.', 'info');
      return;
    }
    setActiveConvId(null);
    setMessages([]);
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      addToast('Generation stopped', 'info');
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawText = textToSend ?? inputMessage;
    const text = rawText.trim();
    if (!text || isStreaming) return;

    setInputMessage('');

    // Append user message to UI immediately
    const userMsg: MessageItem = {
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const initialAssistantMsg: MessageItem = {
      role: 'assistant',
      content: '',
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': getCsrfToken() || '',
          origin: window.location.origin,
        },
        body: JSON.stringify({
          message: text,
          conversationId: activeConvId || undefined,
        }),
        signal: abortController.signal,
        credentials: 'same-origin',
      });

      if (!response.ok) {
        let errJson: any = {};
        try {
          errJson = await response.json();
        } catch (_e) {
          void _e;
        }
        throw new Error(errJson.message || `Chat request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;
          let eventName = 'message';
          let dataStr = '';

          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventName === 'turn_start') {
              if (data.conversationId && data.conversationId !== activeConvId) {
                setActiveConvId(data.conversationId);
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
              }
            } else if (eventName === 'text_delta') {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  last.content = (last.content || '') + data.delta;
                }
                return next;
              });
            } else if (eventName === 'tool_call') {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  const existingTools = last.toolCalls || [];
                  const toolItem: ToolCallRecord = {
                    id: data.id,
                    server: data.server,
                    tool: data.tool,
                    args: data.args,
                    status: 'running',
                  };
                  last.toolCalls = [...existingTools, toolItem];
                }
                return next;
              });
            } else if (eventName === 'tool_result') {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant' && last.toolCalls) {
                  last.toolCalls = last.toolCalls.map((tc) => {
                    if (tc.id === data.id) {
                      return {
                        ...tc,
                        ok: data.ok,
                        durationMs: data.durationMs,
                        summary: data.summary,
                        status: data.ok ? 'success' : 'error',
                      };
                    }
                    return tc;
                  });
                }
                return next;
              });
            } else if (eventName === 'error') {
              addToast(data.message || 'An error occurred during turn execution', 'error');
            } else if (eventName === 'done') {
              // Finalized
              queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
          } catch (parseErr) {
            console.error('Error parsing SSE event:', parseErr);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addToast(err.message || 'Turn failed', 'error');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-2xl">
      {/* Left Sidebar: Conversations List */}
      <aside className="w-80 border-r border-slate-800 flex flex-col bg-slate-950/60">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-sm text-slate-200">Conversations</span>
            <Badge variant="default" size="sm">
              {conversations.length}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={handleStartNewChat}>
            + New
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingConvs ? (
            <div className="p-4 text-center text-xs text-slate-500">Loading chats...</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No conversations yet. Send a message to start!
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConvId;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (!isStreaming) {
                      setActiveConvId(c.id);
                    }
                  }}
                  className={`group flex items-center justify-between p-3 rounded-lg text-sm cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white font-medium border border-slate-700/60'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="truncate text-xs font-medium text-slate-200">{c.title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(c.updatedAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Delete conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete this conversation?')) {
                        deleteConvMutation.mutate(c.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded transition"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Main Chat Area */}
      <section className="flex-1 flex flex-col bg-slate-900/30">
        {/* Chat Header */}
        <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-sm" />
            <h2 className="text-sm font-semibold text-slate-200">
              {activeConvId
                ? conversations.find((c) => c.id === activeConvId)?.title || 'Active Conversation'
                : 'New Conversation'}
            </h2>
          </div>
          <div className="flex items-center space-x-2">
            {isStreaming && (
              <Badge variant="warning" size="sm">
                Streaming Turn...
              </Badge>
            )}
            <Badge variant="default" size="sm">
              Gemini 2.5 Flash
            </Badge>
          </div>
        </header>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoadingDetail && activeConvId ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              Loading conversation history...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-xl">
                C
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-200">Conduit AI Assistant</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Interact with upstream MCP tools across your connected services seamlessly.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full pt-2">
                {[
                  'What tools are currently available on connected MCP servers?',
                  'List all WooCommerce products with prices',
                  'Show recent customer orders and revenue summaries',
                ].map((promptText, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(promptText)}
                    className="p-3 text-left text-xs rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 text-slate-300 hover:text-white transition"
                  >
                    "{promptText}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === 'user';
              return (
                <div key={idx} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center space-x-2 mb-1 px-1">
                    <span className="text-[11px] font-semibold text-slate-400">
                      {isUser ? 'You' : 'Conduit Assistant'}
                    </span>
                  </div>

                  <div
                    className={`max-w-2xl rounded-xl p-4 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-cyan-950/60 border border-cyan-800/50 text-cyan-100 shadow-sm'
                        : 'bg-slate-950/80 border border-slate-800 text-slate-200 shadow-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {/* Tool Calls Section */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
                        <div className="text-[11px] font-semibold tracking-wider uppercase text-slate-400">
                          Executed Upstream Tools ({m.toolCalls.length})
                        </div>
                        {m.toolCalls.map((tc) => {
                          const isExpanded = !!expandedTools[tc.id];
                          const displayName = tc.name || (tc.server && tc.tool ? `${tc.server}__${tc.tool}` : 'tool');
                          return (
                            <div
                              key={tc.id}
                              className="rounded-lg border border-slate-800/80 bg-slate-900/60 text-xs overflow-hidden"
                            >
                              <div
                                onClick={() => toggleToolExpanded(tc.id)}
                                className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 transition"
                              >
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono font-medium text-cyan-300">{displayName}</span>
                                  {tc.durationMs !== undefined && (
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      {tc.durationMs}ms
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2">
                                  {tc.status === 'running' && (
                                    <Badge variant="warning" size="sm">
                                      running
                                    </Badge>
                                  )}
                                  {tc.status === 'success' && (
                                    <Badge variant="success" size="sm">
                                      ok
                                    </Badge>
                                  )}
                                  {tc.status === 'error' && (
                                    <Badge variant="danger" size="sm">
                                      error
                                    </Badge>
                                  )}
                                  <span className="text-slate-500">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="p-3 border-t border-slate-800/60 bg-slate-950/80 space-y-2 text-[11px] font-mono">
                                  {tc.args && (
                                    <div>
                                      <div className="text-slate-500 mb-1">Arguments:</div>
                                      <pre className="p-2 rounded bg-slate-900 text-slate-300 overflow-x-auto">
                                        {JSON.stringify(tc.args, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {tc.summary && (
                                    <div>
                                      <div className="text-slate-500 mb-1">Output Summary:</div>
                                      <pre className="p-2 rounded bg-slate-900 text-slate-300 overflow-x-auto">
                                        {tc.summary}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer */}
        <footer className="border-t border-slate-800 p-4 bg-slate-950/60">
          <div className="relative">
            <textarea
              rows={3}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={
                isStreaming
                  ? 'Conduit assistant is responding...'
                  : 'Ask Conduit Assistant... (Enter to send, Shift+Enter for new line)'
              }
              className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
            />
            <div className="absolute right-3 bottom-3 flex items-center space-x-2">
              {isStreaming ? (
                <Button variant="danger" size="sm" onClick={handleStopGeneration}>
                  Stop
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!inputMessage.trim()}
                  onClick={() => handleSendMessage()}
                >
                  Send
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 px-1">
            <span>Tools are governed by your team role and upstream authorization policies.</span>
            <span>Conduit Team Gateway</span>
          </div>
        </footer>
      </section>
    </div>
  );
};
