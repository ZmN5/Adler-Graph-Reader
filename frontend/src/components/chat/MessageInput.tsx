import { cn } from '@/lib/utils'
import { Send } from 'lucide-react'
import type { MessageInputProps } from './types'

export function MessageInput({
  inputText,
  isStreaming,
  onInputChange,
  onSend,
  inputRef,
}: MessageInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-gray-200 p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，按 Enter 发送..."
          rows={1}
          className="flex-1 resize-none max-h-32 px-3 py-2.5 text-sm bg-gray-100 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-apple-blue/30 placeholder:text-gray-400"
          style={{ minHeight: '40px' }}
          disabled={isStreaming}
        />
        <button
          onClick={onSend}
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
  )
}
