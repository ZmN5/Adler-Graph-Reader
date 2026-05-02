import type { Conversation, Message, GraphNode, Citation } from '@/lib/api-client'

export interface ChatPanelProps {
  bookId: string
  selectedNode: GraphNode | null
  onCitationClick: (chunkId: string) => void
  className?: string
}

export interface ConversationListProps {
  conversations: Conversation[]
  currentConversationId: string | null
  onSwitchConversation: (conversationId: string) => void
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string, e: React.MouseEvent) => void
}

export interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  streamingCitations: Citation[]
  onCitationClick: (chunkId: string) => void
  renderTextWithCitations: (text: string, citations: Citation[]) => React.ReactNode
  messagesEndRef: React.RefObject<HTMLDivElement>
}

export interface MessageInputProps {
  inputText: string
  isStreaming: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  inputRef: React.RefObject<HTMLTextAreaElement>
}

export interface NodeContextBannerProps {
  nodeContext: GraphNode | null
  onAskAboutNode: () => void
  onDismiss: () => void
}
