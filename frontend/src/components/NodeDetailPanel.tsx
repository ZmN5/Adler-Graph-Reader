import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { GraphNode, getNode, NodeDetails, GraphEdge, getBookGraph, getChunk, ChunkDetails } from '@/lib/api-client'
import { X, ExternalLink, BookOpen, FileText } from 'lucide-react'

interface NodeDetailPanelProps {
  node: GraphNode | null
  bookId?: string
  className?: string
  onCitationClick?: (chunkId: string) => void
  onClose?: () => void
  /** Called when user clicks "View in PDF" button */
  onViewInPDF?: (pageNumber: number) => void
}

export function NodeDetailPanel({
  node,
  bookId,
  className,
  onCitationClick,
  onClose,
  onViewInPDF,
}: NodeDetailPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [nodeDetails, setNodeDetails] = useState<NodeDetails | null>(null)
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pageNumber, setPageNumber] = useState<number | null>(null)
  const [chunkContents, setChunkContents] = useState<Map<string, ChunkDetails>>(new Map())
  const [loadingChunks, setLoadingChunks] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!node) {
      setNodeDetails(null)
      setEdges([])
      setChunkContents(new Map())
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const loadDetails = async () => {
      try {
        // Get full node details
        const details = await getNode(node.id)
        if (!cancelled) {
          setNodeDetails(details)
          setPageNumber(details.page_number ?? null)
        }

        // If we have a bookId, fetch edges for this book
        if (bookId) {
          const graphData = await getBookGraph(bookId)
          if (!cancelled) {
            // Filter edges where this node is source or target
            const nodeEdges = graphData.edges.filter(
              (edge) => edge.source_node_id === node.id || edge.target_node_id === node.id
            )
            setEdges(nodeEdges)
          }
        }

        // Load chunk contents for source citations
        if (node.source_chunk_ids.length > 0) {
          const chunkIdsToLoad = node.source_chunk_ids.slice(0, 10) // Load first 10
          const chunkMap = new Map<string, ChunkDetails>()
          const loadingSet = new Set<string>()

          chunkIdsToLoad.forEach(id => loadingSet.add(id))
          if (!cancelled) {
            setLoadingChunks(loadingSet)
          }

          // Load chunks in parallel
          await Promise.all(
            chunkIdsToLoad.map(async (chunkId) => {
              try {
                const chunk = await getChunk(chunkId)
                if (!cancelled) {
                  chunkMap.set(chunkId, chunk)
                }
              } catch (err) {
                console.error(`Failed to load chunk ${chunkId}:`, err)
              }
            })
          )

          if (!cancelled) {
            setChunkContents(chunkMap)
            setLoadingChunks(new Set())
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load details')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadDetails()

    return () => {
      cancelled = true
    }
  }, [node, bookId])

  const handleCitationClick = useCallback(
    (chunkId: string) => {
      onCitationClick?.(chunkId)
    },
    [onCitationClick]
  )

  if (!node) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/50">
        <h2 className="text-lg font-semibold truncate">{node.name}</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="text-center text-destructive py-4">
            <p>{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Description */}
            {node.description && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Description</h3>
                <p className="text-sm">{node.description}</p>
              </div>
            )}

            {/* Page Number & View in PDF */}
            {(pageNumber || onViewInPDF) && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Location</h3>
                <div className="flex items-center gap-3">
                  {pageNumber && (
                    <span className="text-sm">Page {pageNumber}</span>
                  )}
                  {onViewInPDF && pageNumber && (
                    <button
                      onClick={() => onViewInPDF(pageNumber)}
                      className={cn(
                        'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'transition-colors'
                      )}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View in PDF
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Examples */}
            {nodeDetails?.examples && nodeDetails.examples.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Examples</h3>
                <ul className="space-y-2">
                  {nodeDetails.examples.map((example, idx) => (
                    <li key={idx} className="text-sm bg-muted/50 rounded-md p-2">
                      {example}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Source Citations */}
            {node.source_chunk_ids.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Source Citations ({node.source_chunk_ids.length})
                </h3>
                <div className="space-y-1">
                  {node.source_chunk_ids.slice(0, 10).map((chunkId) => {
                    const chunk = chunkContents.get(chunkId)
                    const isLoadingChunk = loadingChunks.has(chunkId)
                    // Get summary text: first 50 chars of content or placeholder
                    const summary = chunk
                      ? chunk.content.slice(0, 50).replace(/\n/g, ' ') + (chunk.content.length > 50 ? '...' : '')
                      : isLoadingChunk
                      ? 'Loading...'
                      : `${chunkId.substring(0, 8)}...`

                    return (
                      <button
                        key={chunkId}
                        onClick={() => handleCitationClick(chunkId)}
                        className={cn(
                          'flex items-center gap-2 w-full text-left text-sm rounded-md px-2 py-1.5',
                          'hover:bg-muted transition-colors text-primary'
                        )}
                      >
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate" title={chunk?.content || chunkId}>
                          {summary}
                        </span>
                      </button>
                    )
                  })}
                  {node.source_chunk_ids.length > 10 && (
                    <p className="text-xs text-muted-foreground pl-2">
                      +{node.source_chunk_ids.length - 10} more citations
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Connected Edges */}
            {edges.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Related Concepts ({edges.length})
                </h3>
                <div className="space-y-2">
                  {edges.map((edge) => {
                    const isSource = edge.source_node_id === node.id
                    const otherNodeId = isSource ? edge.target_node_id : edge.source_node_id
                    return (
                      <div
                        key={edge.id}
                        className="flex items-center gap-2 text-sm bg-muted/50 rounded-md p-2"
                      >
                        <BookOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">
                          <span className="font-medium">{edge.relation_type}</span>
                          {' to '}
                          <span className="text-primary">{otherNodeId.substring(0, 8)}...</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-muted-foreground">
              {nodeDetails?.language && <p>Language: {nodeDetails.language}</p>}
              {nodeDetails?.category && <p>Category: {nodeDetails.category}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}