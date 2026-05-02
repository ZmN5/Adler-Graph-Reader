import { cn } from '@/lib/utils'
import { Bot, Sparkles, User } from 'lucide-react'
import type { MessageListProps } from './types'
import type { Citation } from '@/lib/api-client'

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

export function MessageList({
  messages,
  isStreaming,
  streamingText,
  streamingCitations,
  onCitationClick,
  renderTextWithCitations,
  messagesEndRef,
}: MessageListProps) {
  return (
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
  )
}
