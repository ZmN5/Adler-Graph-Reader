import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Plus, Trash2, ChevronDown, MessageSquare } from 'lucide-react'
import type { ConversationListProps } from './types'

export function ConversationList({
  conversations,
  currentConversationId,
  onSwitchConversation,
  onNewConversation,
  onDeleteConversation,
}: ConversationListProps) {
  const [showMenu, setShowMenu] = useState(false)

  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId
  )

  return (
    <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2 flex items-center justify-between bg-slate-50">
      <div className="flex items-center gap-2 min-w-0">
        <MessageSquare className="h-4 w-4 text-apple-blue flex-shrink-0" />
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
          >
            <span className="truncate max-w-[180px]">
              {currentConversation?.title || '对话'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-apple-lg z-20 overflow-hidden">
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      onNewConversation()
                      setShowMenu(false)
                    }}
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
                      onClick={() => {
                        onSwitchConversation(conv.id)
                        setShowMenu(false)
                      }}
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
                          onClick={(e) => onDeleteConversation(conv.id, e)}
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
        onClick={onNewConversation}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        title="新建对话"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
