import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  GraphNode, getNode, NodeDetails, GraphEdge, getBookGraph,
  getChunk, ChunkDetails, getNodeSummary, getNodeRetrieval,
  SummaryResponse, RetrievalResponse, Citation, getNodeSummaryStream
} from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
import { X, FileText } from 'lucide-react'
import { NodeSummary } from './node-detail/NodeSummary'
import { NodeCitations } from './node-detail/NodeCitations'
import { NodeEdges } from './node-detail/NodeEdges'
import { NodeRetrieval } from './node-detail/NodeRetrieval'

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

export function NodeDetailPanel({
  node,
  bookId,
  className,
  onCitationClick,
  onClose,
  onViewInBook,
  onRelatedNodeClick,
  bookFormat = 'pdf',
}: NodeDetailPanelProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [nodeDetails, setNodeDetails] = useState<NodeDetails | null>(null)
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pageNumber, setPageNumber] = useState<number | null>(null)
  const [chunkContents, setChunkContents] = useState<Map<string, ChunkDetails>>(new Map())
  const [loadingChunks, setLoadingChunks] = useState<Set<string>>(new Set())
  const [relatedNodes, setRelatedNodes] = useState<Map<string, GraphNode>>(new Map())

  // Source-grounded summary states
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [retrievalResults, setRetrievalResults] = useState<RetrievalResponse | null>(null)

  // Streaming summary states
  const [streamingText, setStreamingText] = useState('')
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  // Ref to track current node ID and abort controller for stale requests
  const currentNodeIdRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!node) {
      setNodeDetails(null)
      setEdges([])
      setChunkContents(new Map())
      setRelatedNodes(new Map())
      setSummary(null)
      setRetrievalResults(null)
      setSummaryError(null)
      // Abort any in-flight request
      abortControllerRef.current?.abort()
      currentNodeIdRef.current = null
      return
    }

    // Abort any in-flight request for previous node
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    // Skip if this is the same node we're already loading
    if (currentNodeIdRef.current === node.id) {
      return
    }
    currentNodeIdRef.current = node.id

    let cancelled = false
    const currentNodeId = node.id
    setIsLoading(true)
    setSummaryLoading(true)
    setError(null)
    setSummaryError(null)

    const loadDetails = async () => {
      try {
        // Get full node details
        const details = await getNode(node.id)
        // Skip if node changed or effect was cleaned up
        if (cancelled || currentNodeIdRef.current !== currentNodeId) {
          return
        }
        setNodeDetails(details)
        setPageNumber(details.page_number ?? null)

        // Fetch source-grounded summary (streaming)
        setStreamingText('')
        setStreamingCitations([])
        setIsStreaming(true)
        try {
          const generator = await getNodeSummaryStream(node.id, abortControllerRef.current?.signal)
          if (cancelled || currentNodeIdRef.current !== currentNodeId) {
            return
          }
          for await (const chunk of generator) {
            // Skip if node changed or effect was cleaned up
            if (cancelled || currentNodeIdRef.current !== currentNodeId) break
            if (chunk.type === 'content' && chunk.text) {
              flushSync(() => {
                setStreamingText(prev => prev + chunk.text)
              })
            } else if (chunk.type === 'citation' && chunk.index !== undefined) {
              const citation: Citation = {
                index: chunk.index,
                chunk_id: chunk.chunk_id || '',
                page_start: chunk.page_start || 0,
                page_end: chunk.page_end || 0,
                excerpt: chunk.excerpt || ''
              }
              flushSync(() => {
                setStreamingCitations(prev => [...prev, citation])
              })
            } else if (chunk.type === 'done' || chunk.type === 'error') {
              break
            }
          }
        } catch (err) {
          if (!cancelled) {
            setSummaryError(err instanceof Error ? err.message : 'Failed to load summary')
          }
        } finally {
          if (!cancelled) {
            setIsStreaming(false)
            setSummaryLoading(false)
          }
        }

        // Fetch retrieval results
        try {
          const retrievalData = await getNodeRetrieval(node.id, 10)
          if (!cancelled) {
            setRetrievalResults(retrievalData)
          }
        } catch (err) {
          console.error('Failed to load retrieval results:', err)
        }

        // If we have a bookId, fetch edges and related nodes for this book
        if (bookId) {
          const graphData = await getBookGraph(bookId)
          if (!cancelled) {
            // Filter edges where this node is source or target
            const nodeEdges = graphData.edges.filter(
              (edge) => edge.source_node_id === node.id || edge.target_node_id === node.id
            )
            setEdges(nodeEdges)

            // Build a map of related nodes (from graph data)
            const relatedNodeMap = new Map<string, GraphNode>()
            nodeEdges.forEach((edge) => {
              const otherNodeId = edge.source_node_id === node.id ? edge.target_node_id : edge.source_node_id
              const otherNode = graphData.nodes.find((n) => n.id === otherNodeId)
              if (otherNode) {
                relatedNodeMap.set(otherNodeId, otherNode)
              }
            })
            setRelatedNodes(relatedNodeMap)
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
      abortControllerRef.current?.abort()
      currentNodeIdRef.current = null
    }
  }, [node, bookId])

  const handleCitationClick = useCallback(
    (chunkId: string) => {
      onCitationClick?.(chunkId)
    },
    [onCitationClick]
  )

  const handleRelatedNodeClick = useCallback(
    (relatedNode: GraphNode) => {
      onRelatedNodeClick?.(relatedNode)
    },
    [onRelatedNodeClick]
  )

  // Retry loading summary
  const handleRetrySummary = useCallback(async () => {
    if (!node) return
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const summaryData = await getNodeSummary(node.id)
      setSummary(summaryData)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to load summary')
    } finally {
      setSummaryLoading(false)
    }
  }, [node])

  // Render summary with clickable citation markers
  const renderSummaryWithCitations = useCallback((summaryText: string) => {
    // Use streamingCitations if available, otherwise use summary.citations
    const citations = streamingCitations.length > 0 ? streamingCitations : (summary?.citations || [])

    // Match [Source: X] pattern
    const parts = summaryText.split(/(\[Source:\s*\d+\])/g)
    return parts.map((part, index) => {
      const match = part.match(/\[Source:\s*(\d+)\]/)
      if (match) {
        const citationIndex = parseInt(match[1], 10)
        return (
          <button
            key={index}
            onClick={() => {
              const citation = citations.find(c => c.index === citationIndex)
              if (citation) {
                handleCitationClick(citation.chunk_id)
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
  }, [streamingCitations, summary?.citations, handleCitationClick])

  if (!node) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full bg-white border-l border-gray-200', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-slate-50">
        <div className="flex items-center gap-3 min-w-0">
          {node.is_core && (
            <div className="w-2 h-2 rounded-full bg-apple-blue animate-pulse-subtle" />
          )}
          <h2 className="text-base font-sans font-semibold truncate text-gray-900">{node.name}</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
            <span className="ml-3 text-sm text-gray-500 font-sans">{t('nodeDetail.loading')}</span>
          </div>
        )}

        {error && (
          <div className="text-center text-red-500 py-4 font-sans">
            <p>{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Source-Grounded Summary Section */}
            <NodeSummary
              summaryLoading={summaryLoading}
              isStreaming={isStreaming}
              streamingText={streamingText}
              streamingCitations={streamingCitations}
              summary={summary}
              summaryError={summaryError}
              onRetrySummary={handleRetrySummary}
              onCitationClick={handleCitationClick}
              renderSummaryWithCitations={renderSummaryWithCitations}
            />

            {/* Description */}
            {node.description && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-sans font-medium text-gray-500 mb-2">{t('nodeDetail.description')}</h3>
                <p className="text-sm text-gray-700 font-sans">{node.description}</p>
              </div>
            )}

            {/* Location & View in Book */}
            {(pageNumber || onViewInBook) && (
              <div className="flex items-center gap-4">
                {pageNumber && (
                  <span className="text-sm text-gray-600 font-sans">
                    {bookFormat === 'epub' ? `${t('nodeDetail.chapter')} ${pageNumber}` : `${t('nodeDetail.page')} ${pageNumber}`}
                  </span>
                )}
                {onViewInBook && pageNumber && (
                  <button
                    onClick={() => onViewInBook(pageNumber)}
                    className={cn(
                      'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-sans',
                      'bg-blue-50 border border-blue-200 text-blue-600',
                      'hover:bg-blue-100 hover:border-blue-300 transition-all'
                    )}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {bookFormat === 'epub' ? t('nodeDetail.viewInEpub') : t('nodeDetail.viewInPdf')}
                  </button>
                )}
              </div>
            )}

            {/* Examples */}
            {nodeDetails?.examples && nodeDetails.examples.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-sans font-medium text-gray-500 mb-2">{t('nodeDetail.examples')}</h3>
                <ul className="space-y-2">
                  {nodeDetails.examples.map((example, idx) => (
                    <li key={idx} className="text-sm text-gray-700 bg-slate-50 rounded-lg p-2 font-sans">
                      • {example}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Source Citations */}
            <NodeCitations
              sourceChunkIds={node.source_chunk_ids}
              chunkContents={chunkContents}
              loadingChunks={loadingChunks}
              onCitationClick={handleCitationClick}
            />

            {/* Retrieval Results Section */}
            <NodeRetrieval
              retrievalResults={retrievalResults}
              onCitationClick={handleCitationClick}
            />

            {/* Connected Edges */}
            <NodeEdges
              edges={edges}
              currentNodeId={node.id}
              relatedNodes={relatedNodes}
              onRelatedNodeClick={handleRelatedNodeClick}
            />

            {/* Metadata */}
            <div className="text-xs text-gray-400 font-sans border-t border-gray-200 pt-3">
              {nodeDetails?.language && <p>Language: {nodeDetails.language}</p>}
              {nodeDetails?.category && <p>Category: <span className="text-apple-purple">{nodeDetails.category}</span></p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
