import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getCsrfToken } from '../api/client';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';
import {
  ChatIcon,
  PlusIcon,
  StopIcon,
  SendIcon,
  WrenchIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  XCircleIcon,
  ArrowDownIcon,
  TrashIcon,
  RefreshCwIcon,
} from '../components/ui/Icons';

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
  gatewayCode?: string;
  status?: 'running' | 'success' | 'error' | 'pending_approval';
  requiresApproval?: boolean;
}

interface MessageItem {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt?: string;
  error?: string;
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
  const [lastUserPrompt, setLastUserPrompt] = useState<string>('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollActiveRef = useRef(true);

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
        }))
      );
    }
  }, [convDetail, isStreaming]);

  // Handle user scroll detection so auto-scroll does not fight the user
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = distanceToBottom < 60;
    isAutoScrollActiveRef.current = isAtBottom;
    setShowScrollBottom(!isAtBottom);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = messagesContainerRef.current;
    if (el) {
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  };

  // Auto-scroll when messages update, but only if user hasn't scrolled up
  useEffect(() => {
    if (isAutoScrollActiveRef.current) {
      scrollToBottom('auto');
    }
  }, [messages]);

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
      addToast('A response is currently in progress. Please stop it first.', 'info');
      return;
    }
    setActiveConvId(null);
    setMessages([]);
    setLastUserPrompt('');
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      addToast('Response streaming halted', 'info');
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawText = textToSend ?? inputMessage;
    const text = rawText.trim();
    if (!text || isStreaming) return;

    setInputMessage('');
    setLastUserPrompt(text);

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
    isAutoScrollActiveRef.current = true;
    scrollToBottom('smooth');

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
        throw new Error(errJson.message || `Chat request failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response stream body is empty');
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
                        gatewayCode: data.code || (data.ok ? 'OK' : 'TOOL_ERROR'),
                        status: data.ok ? 'success' : 'error',
                      };
                    }
                    return tc;
                  });
                }
                return next;
              });
            } else if (eventName === 'error') {
              const errMsg = data.message || 'An error occurred during turn execution';
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  last.error = errMsg;
                }
                return next;
              });
              addToast(errMsg, 'error');
            } else if (eventName === 'done') {
              queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
          } catch (parseErr) {
            console.error('SSE JSON parse error:', parseErr);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errMsg = err.message || 'Connection interrupted';
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            last.error = errMsg;
          }
          return next;
        });
        addToast(errMsg, 'error');
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

  const handleApproveTool = (toolId: string) => {
    addToast('Tool approved for execution', 'success');
    setMessages((prev) => {
      return prev.map((m) => {
        if (!m.toolCalls) return m;
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === toolId ? { ...tc, status: 'running', requiresApproval: false } : tc
          ),
        };
      });
    });
  };

  const handleDenyTool = (toolId: string) => {
    addToast('Tool execution denied by user', 'info');
    setMessages((prev) => {
      return prev.map((m) => {
        if (!m.toolCalls) return m;
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === toolId
              ? {
                  ...tc,
                  status: 'error',
                  ok: false,
                  requiresApproval: false,
                  summary: 'Action explicitly denied by user',
                }
              : tc
          ),
        };
      });
    });
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-7.5rem)] rounded-xl border border-border-default bg-surface-panel overflow-hidden shadow-sm">
      {/* Sidebar: Conversations List */}
      <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-border-default flex flex-col bg-surface-subtle max-h-48 md:max-h-full">
        <div className="p-3.5 border-b border-border-default flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChatIcon className="w-4 h-4 text-brand" />
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Conversations
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleStartNewChat}
            leftIcon={<PlusIcon className="w-3.5 h-3.5" />}
          >
            New Chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingConvs ? (
            <div className="p-4 text-center text-xs text-text-muted">Loading chats...</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-text-muted">
              No conversations yet. Send a prompt to begin!
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
                  className={`group flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                      : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="truncate font-medium">{c.title}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">
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
                    title={`Delete conversation: ${c.title}`}
                    aria-label={`Delete conversation: ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete conversation "${c.title}"?`)) {
                        deleteConvMutation.mutate(c.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-danger p-1 rounded transition focus:opacity-100 min-h-[32px] min-w-[32px] flex items-center justify-center"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Workspace */}
      <section className="flex-1 flex flex-col bg-surface-panel relative min-h-0">
        {/* Chat Header */}
        <header className="h-14 border-b border-border-default px-6 flex items-center justify-between bg-surface-panel flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-brand animate-pulse" />
            <h1 className="text-sm font-bold text-text-primary">
              {activeConvId
                ? conversations.find((c) => c.id === activeConvId)?.title || 'Conduit Chat'
                : 'New Conversation'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold bg-surface-warning text-text-warning border border-border-warning"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-text-warning animate-ping" />
                Streaming Turn...
              </span>
            )}
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-surface-subtle border border-border-default text-text-muted">
              Gemini 2.5 Flash
            </span>
          </div>
        </header>

        {/* Messages Stream */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6"
        >
          {isLoadingDetail && activeConvId ? (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Loading conversation history...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-4 p-4">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/30 flex items-center justify-center text-brand font-bold text-xl">
                C
              </div>
              <div>
                <h2 className="text-base font-bold text-text-primary">Conduit AI Assistant</h2>
                <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto">
                  Execute authorized upstream tools across connected servers under team policy rules.
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
                    className="p-3 text-left text-xs rounded-lg border border-border-default bg-surface-subtle hover:bg-brand/5 hover:border-brand/40 text-text-secondary hover:text-text-primary transition min-h-[44px]"
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
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-bold text-text-muted">
                      {isUser ? 'You' : 'Conduit Assistant'}
                    </span>
                  </div>

                  <div
                    className={`max-w-2xl rounded-xl p-4 text-sm leading-relaxed border shadow-xs ${
                      isUser
                        ? 'bg-brand/10 border-brand/30 text-text-primary'
                        : 'bg-surface-subtle border-border-default text-text-primary'
                    }`}
                  >
                    {/* Plain text content - strictly no raw HTML */}
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {/* Streaming placeholder dot */}
                    {isStreaming && idx === messages.length - 1 && !m.content && (
                      <span className="inline-block w-2 h-4 bg-brand animate-pulse ml-0.5" />
                    )}

                    {/* Tool Calls Section */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mt-4 space-y-2.5 border-t border-border-default pt-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                          <WrenchIcon className="w-3.5 h-3.5" />
                          <span>Tool Invocations ({m.toolCalls.length})</span>
                        </div>

                        {m.toolCalls.map((tc) => {
                          const isExpanded = !!expandedTools[tc.id];
                          const displayName =
                            tc.name ||
                            (tc.server && tc.tool ? `${tc.server}__${tc.tool}` : 'tool');

                          return (
                            <div
                              key={tc.id}
                              className="rounded-lg border border-border-default bg-surface-panel text-xs overflow-hidden"
                            >
                              {/* Tool Card Header */}
                              <div
                                onClick={() => toggleToolExpanded(tc.id)}
                                className="p-3 flex items-center justify-between cursor-pointer hover:bg-surface-subtle transition min-h-[44px]"
                              >
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDownIcon className="w-4 h-4 text-text-muted" />
                                  ) : (
                                    <ChevronRightIcon className="w-4 h-4 text-text-muted" />
                                  )}
                                  <span className="font-mono font-semibold text-brand">
                                    {displayName}
                                  </span>
                                  {tc.durationMs !== undefined && (
                                    <span className="text-[10px] text-text-muted font-mono">
                                      {tc.durationMs}ms
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {tc.status === 'running' && (
                                    <StatusBadge status="disabled" label="running" />
                                  )}
                                  {tc.status === 'success' && (
                                    <StatusBadge status="connected" label={tc.gatewayCode || 'ok'} />
                                  )}
                                  {tc.status === 'error' && (
                                    <StatusBadge status="unreachable" label={tc.gatewayCode || 'error'} />
                                  )}
                                </div>
                              </div>

                              {/* Destructive Tool Confirmation Card */}
                              {tc.requiresApproval && (
                                <div className="p-3 border-t border-border-warning bg-surface-warning text-text-warning text-xs space-y-2">
                                  <div className="flex items-center gap-1.5 font-bold">
                                    <AlertTriangleIcon className="w-4 h-4" />
                                    <span>Destructive Tool Confirmation Required</span>
                                  </div>
                                  <p>
                                    This tool alters upstream state. Review arguments below before approving execution:
                                  </p>
                                  <div className="flex items-center gap-2 pt-1">
                                    <Button
                                      size="sm"
                                      variant="primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleApproveTool(tc.id);
                                      }}
                                    >
                                      Approve Execution
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="danger"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDenyTool(tc.id);
                                      }}
                                    >
                                      Deny
                                    </Button>
                                  </div>
                                </div>
                              )}

                              {/* Collapsible Tool Details */}
                              {isExpanded && (
                                <div className="p-3 border-t border-border-default bg-surface-subtle space-y-3 font-mono text-[11px]">
                                  {tc.args && (
                                    <div>
                                      <div className="text-text-muted font-bold mb-1">Arguments:</div>
                                      <pre
                                        tabIndex={0}
                                        className="p-2.5 rounded bg-surface-panel border border-border-default text-text-secondary overflow-x-auto focus:outline-none focus:ring-1 focus:ring-brand"
                                      >
                                        {JSON.stringify(tc.args, null, 2)}
                                      </pre>
                                    </div>
                                  )}

                                  {tc.summary && (
                                    <div>
                                      <div className="text-text-muted font-bold mb-1">Execution Summary:</div>
                                      <pre
                                        tabIndex={0}
                                        className="p-2.5 rounded bg-surface-panel border border-border-default text-text-secondary overflow-x-auto focus:outline-none focus:ring-1 focus:ring-brand whitespace-pre-wrap"
                                      >
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

                    {/* Error Banner with Retry */}
                    {m.error && (
                      <div className="mt-3 p-3 rounded-lg bg-surface-danger border border-border-danger text-text-danger text-xs space-y-2">
                        <div className="flex items-center gap-1.5 font-bold">
                          <XCircleIcon className="w-4 h-4 flex-shrink-0" />
                          <span>Turn Execution Failure: {m.error}</span>
                        </div>
                        {lastUserPrompt && (
                          <div className="pt-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleSendMessage(lastUserPrompt)}
                              leftIcon={<RefreshCwIcon className="w-3.5 h-3.5" />}
                            >
                              Retry Last Prompt
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            aria-label="Scroll to newest messages"
            className="absolute bottom-24 right-6 p-2 rounded-full bg-surface-panel border border-border-default shadow-md text-text-primary hover:text-brand hover:border-brand transition min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
          >
            <ArrowDownIcon className="w-4 h-4" />
          </button>
        )}

        {/* Sticky Mobile-Friendly Input Composer */}
        <footer className="border-t border-border-default p-4 bg-surface-subtle flex-shrink-0">
          <div className="relative">
            <textarea
              id="chat-input"
              aria-label="Conduit Assistant Message Input"
              rows={3}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={
                isStreaming
                  ? 'Conduit assistant is responding...'
                  : 'Ask Conduit Assistant... (Enter to send, Shift+Enter for newline)'
              }
              className="w-full resize-none rounded-xl border border-border-default bg-surface-panel px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {isStreaming ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleStopGeneration}
                  leftIcon={<StopIcon className="w-3.5 h-3.5" />}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!inputMessage.trim()}
                  onClick={() => handleSendMessage()}
                  leftIcon={<SendIcon className="w-3.5 h-3.5" />}
                >
                  Send
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-col sm:flex-row items-center justify-between text-[11px] text-text-muted px-1 gap-1">
            <span>Tools are governed by your team role and upstream authorization policies.</span>
            <span className="font-mono">Conduit Team Gateway</span>
          </div>
        </footer>
      </section>
    </div>
  );
};
