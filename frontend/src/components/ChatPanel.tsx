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
import { Loader2 } from 'lucide-react'
import { ConversationList } from './chat/ConversationList'
import { MessageList } from './chat/MessageList'
import { MessageInput } from './chat/MessageInput'
import { NodeContextBanner } from './chat/NodeContextBanner'
import { MarkdownRenderer } from './MarkdownRenderer'

export interface ChatPanelProps {
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
  const [nodeContext, setNodeContext] = useState<GraphNode | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevNodeIdRef = useRef<string | null>(null)
  const activeNodeIdRef = useRef<string | null>(null)

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
    activeNodeIdRef.current = nodeContext.id
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
        controller.signal,
        activeNodeIdRef.current
      )
      activeNodeIdRef.current = null

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

  // Render citations in text with Markdown support
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
        // Determine if this part contains block-level markdown
        const trimmed = part.trimStart()
        const isBlock =
          part.includes('\n\n') ||
          trimmed.startsWith('#') ||
          trimmed.startsWith('- ') ||
          trimmed.startsWith('* ') ||
          trimmed.startsWith('1. ') ||
          trimmed.startsWith('> ') ||
          trimmed.startsWith('```') ||
          trimmed.startsWith('|')
        return (
          <MarkdownRenderer
            key={index}
            text={part}
            inline={!isBlock}
          />
        )
      })
    },
    [onCitationClick]
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
      <ConversationList
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSwitchConversation={handleSwitchConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamingCitations={streamingCitations}
        onCitationClick={onCitationClick}
        renderTextWithCitations={renderTextWithCitations}
        messagesEndRef={messagesEndRef}
      />

      <NodeContextBanner
        nodeContext={nodeContext}
        onAskAboutNode={handleAskAboutNode}
        onDismiss={handleDismissNodeContext}
      />

      <MessageInput
        inputText={inputText}
        isStreaming={isStreaming}
        onInputChange={setInputText}
        onSend={handleSend}
        inputRef={inputRef}
      />
    </div>
  )
}
