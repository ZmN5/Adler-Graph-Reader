import type { GraphNode, GraphEdge, ChunkDetails, SummaryResponse, RetrievalResponse, Citation } from '@/lib/api-client'

export interface NodeDetailPanelProps {
  node: GraphNode | null
  bookId?: string
  className?: string
  onCitationClick?: (chunkId: string) => void
  onClose?: () => void
  /** Called when user clicks "View in Book" button (works for both PDF and EPUB) */
  onViewInBook?: (pageNumber: number) => void
  /** Called when user clicks on a related concept */
  onRelatedNodeClick?: (node: GraphNode) => void
  /** Book format to determine button label */
  bookFormat?: 'pdf' | 'epub'
}

export interface NodeSummaryProps {
  summaryLoading: boolean
  isStreaming: boolean
  streamingText: string
  streamingCitations: Citation[]
  summary: SummaryResponse | null
  summaryError: string | null
  onRetrySummary: () => void
  onCitationClick: (chunkId: string) => void
  renderSummaryWithCitations: (summaryText: string) => React.ReactNode
}

export interface NodeCitationsProps {
  sourceChunkIds: string[]
  chunkContents: Map<string, ChunkDetails>
  loadingChunks: Set<string>
  onCitationClick: (chunkId: string) => void
}

export interface NodeEdgesProps {
  edges: GraphEdge[]
  currentNodeId: string
  relatedNodes: Map<string, GraphNode>
  onRelatedNodeClick: (node: GraphNode) => void
}

export interface NodeRetrievalProps {
  retrievalResults: RetrievalResponse | null
  onCitationClick: (chunkId: string) => void
}
