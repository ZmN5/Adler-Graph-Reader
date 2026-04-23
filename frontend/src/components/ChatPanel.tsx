import { useState, useEffect, useRef, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  type Conversation,
  type Message,
  type GraphNode,
  type Citation,
  createConversation,
  listConversations,
  getConversation,
  deleteConversation,
  sendMessageStream,
} from '@/lib/api-client'
import {
  Send,
  Plus,
  Trash2,
  ChevronDown,
  MessageSquare,
  Bot,
  User,
  Loader2,
  Sparkles,
} from 'lucide-react'

interface ChatPanelProps {
  bookId: string
  selectedNode: GraphNode | null
  onCitationClick: (chunkId: string) => void
  className?: string
}

export function ChatPanel({
  bookId,
  selectedNode,
  onCitationClick,
  className,
}: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(
    null
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showConversationMenu, setShowConversationMenu] = useState(false)
  const [nodeContext, setNodeContext] = useState<GraphNode | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevNodeIdRef = useRef<string | null>(null)

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText, scrollToBottom])

  // Load conversations on mount
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const convs = await listConversations(bookId)
        if (cancelled) return

        if (convs.length > 0) {
          setConversations(convs)
          const firstConv = convs[0]
          setCurrentConversationId(firstConv.id)
          const convWithMessages = await getConversation(firstConv.id)
          if (cancelled) return
          setMessages(convWithMessages.messages)
        } else {
          // Auto-create first conversation
          const newConv = await createConversation(bookId, '新对话')
          if (cancelled) return
          setConversations([newConv])
          setCurrentConversationId(newConv.id)
          setMessages([])
        }
      } catch (err) {
        console.error('Failed to load conversations:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [bookId])

  // Handle node selection change - inject context
  useEffect(() => {
    if (!selectedNode) return
    if (prevNodeIdRef.current === selectedNode.id) return
    prevNodeIdRef.current = selectedNode.id

    // Show node context suggestion instead of auto-injecting
    setNodeContext(selectedNode)
  }, [selectedNode])

  // Accept node context as a question
  const handleAskAboutNode = useCallback(() => {
    if (!nodeContext) return
    const question = `请介绍一下「${nodeContext.name}」`
    setInputText(question)
    setNodeContext(null)
    inputRef.current?.focus()
  }, [nodeContext])

  // Dismiss node context
  const handleDismissNodeContext = useCallback(() => {
    setNodeContext(null)
  }, [])

  // Switch conversation
  const handleSwitchConversation = useCallback(
    async (conversationId: string) => {
      if (conversationId === currentConversationId) {
        setShowConversationMenu(false)
        return
      }
      setIsLoading(true)
      try {
        const conv = await getConversation(conversationId)
        setCurrentConversationId(conversationId)
        setMessages(conv.messages)
        setStreamingText('')
        setStreamingCitations([])
      } catch (err) {
        console.error('Failed to load conversation:', err)
      } finally {
        setIsLoading(false)
        setShowConversationMenu(false)
      }
    },
    [currentConversationId]
  )

  // Create new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      const newConv = await createConversation(bookId, '新对话')
      setConversations((prev) => [newConv, ...prev])
      setCurrentConversationId(newConv.id)
      setMessages([])
      setStreamingText('')
      setStreamingCitations([])
      setShowConversationMenu(false)
    } catch (err) {
      console.error('Failed to create conversation:', err)
    }
  }, [bookId])

  // Delete conversation
  const handleDeleteConversation = useCallback(
    async (conversationId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await deleteConversation(conversationId)
        setConversations((prev) =>
          prev.filter((c) => c.id !== conversationId)
        )
        if (currentConversationId === conversationId) {
          const remaining = conversations.filter(
            (c) => c.id !== conversationId
          )
          if (remaining.length > 0) {
            const nextConv = remaining[0]
            setCurrentConversationId(nextConv.id)
            const conv = await getConversation(nextConv.id)
            setMessages(conv.messages)
          } else {
            const newConv = await createConversation(bookId, '新对话')
            setConversations([newConv])
            setCurrentConversationId(newConv.id)
            setMessages([])
          }
        }
        setStreamingText('')
        setStreamingCitations([])
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    },
    [currentConversationId, conversations, bookId]
  )

  // Send message
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !currentConversationId || isStreaming) return

    const content = inputText.trim()
    setInputText('')
    setNodeContext(null)
    setIsStreaming(true)
    setStreamingText('')
    setStreamingCitations([])

    // Optimistically add user message
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: currentConversationId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMessage])

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const generator = await sendMessageStream(
        currentConversationId,
        content,
        controller.signal
      )

      for await (const chunk of generator) {
        if (controller.signal.aborted) break

        if (chunk.type === 'content' && chunk.text) {
          flushSync(() => {
            setStreamingText((prev) => prev + chunk.text)
          })
        } else if (chunk.type === 'citation' && chunk.index !== undefined) {
          const citation: Citation = {
            index: chunk.index,
            chunk_id: chunk.chunk_id || '',
            page_start: chunk.page_start || 0,
            page_end: chunk.page_end || 0,
            excerpt: chunk.excerpt || '',
          }
          flushSync(() => {
            setStreamingCitations((prev) => [...prev, citation])
          })
        } else if (chunk.type === 'done' || chunk.type === 'error') {
          break
        }
      }

      // Reload messages from server to get the saved assistant message
      const conv = await getConversation(currentConversationId)
      setMessages(conv.messages)
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsStreaming(false)
      setStreamingText('')
      setStreamingCitations([])
      abortControllerRef.current = null
    }
  }, [inputText, currentConversationId, isStreaming])

  // Handle Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // Render citations in text
  const renderTextWithCitations = useCallback(
    (text: string, citations: Citation[]) => {
      const parts = text.split(/(\[Source:\s*\d+\])/g)
      return parts.map((part, index) => {
        const match = part.match(/\[Source:\s*(\d+)\]/)
        if (match) {
          const citationIndex = parseInt(match[1], 10)
          return (
            <button
              key={index}
              onClick={() => {
                const citation = citations.find(
                  (c) => c.index === citationIndex
                )
                if (citation) {
                  onCitationClick(citation.chunk_id)
                }
              }}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
            >
              [{citationIndex}]
            </button>
          )
        }
        return <span key={index}>{part}</span>
      })
    },
    [onCitationClick]
  )

  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId
  )

  if (isLoading && conversations.length === 0) {
    return (
      <div
        className={cn(
          'h-full flex items-center justify-center bg-white',
          className
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className={cn('h-full flex flex-col bg-white', className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-apple-blue flex-shrink-0" />
          <div className="relative">
            <button
              onClick={() => setShowConversationMenu(!showConversationMenu)}
              className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              <span className="truncate max-w-[180px]">
                {currentConversation?.title || '对话'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </button>

            {showConversationMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowConversationMenu(false)}
                />
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-apple-lg z-20 overflow-hidden">
                  <div className="p-1.5">
                    <button
                      onClick={handleNewConversation}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-apple-blue hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      新建对话
                    </button>
                  </div>
                  <div className="border-t border-gray-100 max-h-48 overflow-y-auto">
                    {conversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleSwitchConversation(conv.id)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                          conv.id === currentConversationId
                            ? 'bg-blue-50 text-apple-blue'
                            : 'text-gray-700'
                        )}
                      >
                        <span className="truncate flex-1 text-left">
                          {conv.title || '对话'}
                        </span>
                        {conversations.length > 1 && (
                          <button
                            onClick={(e) =>
                              handleDeleteConversation(conv.id, e)
                            }
                            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <button
          onClick={handleNewConversation}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          title="新建对话"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <Bot className="h-10 w-10 mb-3 text-gray-300" />
            <p className="text-sm">开始提问，探索书中内容</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            citations={msg.citations}
            onCitationClick={onCitationClick}
            renderTextWithCitations={renderTextWithCitations}
          />
        ))}

        {/* Streaming message */}
        {isStreaming && streamingText && (
          <MessageBubble
            role="assistant"
            content={streamingText}
            citations={
              streamingCitations.length > 0
                ? JSON.stringify(streamingCitations)
                : undefined
            }
            onCitationClick={onCitationClick}
            renderTextWithCitations={renderTextWithCitations}
            isStreaming
          />
        )}

        {isStreaming && !streamingText && (
          <div className="flex items-start gap-2.5">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-apple-blue animate-pulse" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                <div
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0.15s' }}
                />
                <div
                  className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0.3s' }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Node context suggestion */}
      {nodeContext && (
        <div className="flex-shrink-0 mx-4 mb-2 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-apple-blue flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700">
              已选中节点
              <span className="font-medium text-apple-blue">「{nodeContext.name}」</span>
            </p>
          </div>
          <button
            onClick={handleAskAboutNode}
            className="text-sm px-3 py-1.5 bg-apple-blue text-white rounded-lg hover:bg-blue-600 transition-colors flex-shrink-0"
          >
            询问
          </button>
          <button
            onClick={handleDismissNodeContext}
            className="text-sm px-2 py-1.5 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
          >
            忽略
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，按 Enter 发送..."
            rows={1}
            className="flex-1 resize-none max-h-32 px-3 py-2.5 text-sm bg-gray-100 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-apple-blue/30 placeholder:text-gray-400"
            style={{ minHeight: '40px' }}
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isStreaming}
            className={cn(
              'flex-shrink-0 p-2.5 rounded-xl transition-colors',
              inputText.trim() && !isStreaming
                ? 'bg-apple-blue text-white hover:bg-blue-600'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MessageBubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
  role: string
  content: string
  citations?: string | null
  onCitationClick: (chunkId: string) => void
  renderTextWithCitations: (text: string, citations: Citation[]) => React.ReactNode
  isStreaming?: boolean
}

function MessageBubble({
  role,
  content,
  citations,
  onCitationClick,
  renderTextWithCitations,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === 'user'

  let parsedCitations: Citation[] = []
  if (citations) {
    try {
      parsedCitations = JSON.parse(citations)
    } catch {
      // ignore parse error
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
          isUser ? 'bg-gray-200' : 'bg-blue-50'
        )}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-gray-600" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-apple-blue" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-apple-blue text-white rounded-tr-sm'
            : 'bg-gray-100 text-gray-800 rounded-tl-sm'
        )}
      >
        <div
          className={cn(
            'text-sm leading-relaxed whitespace-pre-wrap',
            isUser ? 'text-white' : 'text-gray-700'
          )}
        >
          {isUser ? (
            content
          ) : (
            <>
              {renderTextWithCitations(content, parsedCitations)}
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-apple-blue animate-pulse rounded-sm" />
              )}
            </>
          )}
        </div>

        {/* Citations for assistant */}
        {!isUser && parsedCitations.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-200/60">
            <p className="text-[10px] text-gray-500 mb-1.5 font-medium">来源</p>
            <div className="flex flex-wrap gap-1.5">
              {parsedCitations.map((citation) => (
                <button
                  key={citation.index}
                  onClick={() => onCitationClick(citation.chunk_id)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-white border border-gray-200 rounded-md hover:bg-blue-50 hover:border-blue-200 transition-colors"
                >
                  <span className="text-blue-600 font-medium">[{citation.index}]</span>
                  <span className="text-gray-500 truncate max-w-[120px]">
                    {citation.excerpt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
