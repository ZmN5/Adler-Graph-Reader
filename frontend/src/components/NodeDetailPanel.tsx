import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  GraphNode, getNode, NodeDetails, GraphEdge, getBookGraph,
  getChunk, ChunkDetails, getNodeSummary, getNodeRetrieval,
  SummaryResponse, RetrievalResponse, Citation, getNodeSummaryStream
} from '@/lib/api-client'
import { X, ExternalLink, BookOpen, FileText, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

interface NodeDetailPanelProps {
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
  const [showRetrievalDetails, setShowRetrievalDetails] = useState(false)

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
              setStreamingText(prev => prev + chunk.text)
              // Yield to event loop to allow React to re-render between chunks
              await new Promise(resolve => setTimeout(resolve, 0))
            } else if (chunk.type === 'citation' && chunk.index !== undefined) {
              const citation: Citation = {
                index: chunk.index,
                chunk_id: chunk.chunk_id || '',
                page_start: chunk.page_start || 0,
                page_end: chunk.page_end || 0,
                excerpt: chunk.excerpt || ''
              }
              setStreamingCitations(prev => [...prev, citation])
              // Yield to event loop to allow React to re-render between chunks
              await new Promise(resolve => setTimeout(resolve, 0))
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

  // Sort retrieval results by final_score descending
  const sortedRetrievalChunks = retrievalResults?.chunks
    ? [...retrievalResults.chunks].sort((a, b) => b.final_score - a.final_score)
    : []

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
            {/* Source-Grounded Summary Section */}
            <div className="mb-6 border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/30 px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium">AI 总结</h3>
              </div>
              <div className="p-4">
                {(summaryLoading || isStreaming) && streamingText === '' && (
                  <div className="flex items-center gap-3 py-4">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-sm text-muted-foreground">正在分析相关段落...</span>
                  </div>
                )}

                {summaryError && (
                  <div className="py-4">
                    <p className="text-sm text-destructive mb-3">{summaryError}</p>
                    <button
                      onClick={handleRetrySummary}
                      className={cn(
                        'flex items-center gap-2 text-sm px-3 py-2 rounded-md',
                        'bg-muted hover:bg-muted/80 transition-colors'
                      )}
                    >
                      <RefreshCw className="h-4 w-4" />
                      重试
                    </button>
                  </div>
                )}

                {((!summaryLoading && summary) || streamingText !== '') && (
                  <div className="space-y-4">
                    {/* Summary Text - use streaming text or static summary */}
                    <div className="text-sm leading-relaxed text-foreground">
                      {streamingText !== '' ? (
                        renderSummaryWithCitations(streamingText)
                      ) : summary ? (
                        renderSummaryWithCitations(summary.summary)
                      ) : null}
                    </div>

                    {/* Citations List - use streaming citations or static citations */}
                    {(streamingCitations.length > 0 || (summary && summary.citations.length > 0)) && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">来源引用</h4>
                        <div className="space-y-2">
                          {(streamingCitations.length > 0 ? streamingCitations : summary?.citations || []).map((citation) => (
                            <button
                              key={citation.index}
                              onClick={() => handleCitationClick(citation.chunk_id)}
                              className={cn(
                                'w-full text-left text-xs p-2 rounded-md',
                                'bg-muted/30 hover:bg-muted/50 transition-colors'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <span className="flex-shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                                  [{citation.index}]
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-muted-foreground line-clamp-2">
                                    {citation.excerpt}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    第 {citation.page_start}{citation.page_start !== citation.page_end ? `-${citation.page_end}` : ''} 页
                                  </p>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            {node.description && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Description</h3>
                <p className="text-sm">{node.description}</p>
              </div>
            )}

            {/* Location & View in Book */}
            {(pageNumber || onViewInBook) && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Location</h3>
                <div className="flex items-center gap-3">
                  {pageNumber && (
                    <span className="text-sm">
                      {bookFormat === 'epub' ? `Chapter ${pageNumber}` : `Page ${pageNumber}`}
                    </span>
                  )}
                  {onViewInBook && pageNumber && (
                    <button
                      onClick={() => onViewInBook(pageNumber)}
                      className={cn(
                        'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'transition-colors'
                      )}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {bookFormat === 'epub' ? 'View in EPUB' : 'View in PDF'}
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

            {/* Retrieval Results Section */}
            {sortedRetrievalChunks.length > 0 && (
              <div className="mb-6 border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowRetrievalDetails(!showRetrievalDetails)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors border-b border-border"
                >
                  <h3 className="text-sm font-medium">检索详情</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {sortedRetrievalChunks.length} 个相关段落
                    </span>
                    {showRetrievalDetails ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {showRetrievalDetails && (
                  <div className="p-4 space-y-3">
                    {sortedRetrievalChunks.map((chunk, index) => (
                      <button
                        key={chunk.chunk_id}
                        onClick={() => handleCitationClick(chunk.chunk_id)}
                        className={cn(
                          'w-full text-left p-3 rounded-md',
                          'bg-muted/30 hover:bg-muted/50 transition-colors'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex-shrink-0 text-xs text-muted-foreground font-mono">
                            #{index + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground line-clamp-3 mb-2">
                              {chunk.content}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                              <span>第 {chunk.page_start}-{chunk.page_end} 页</span>
                              <span className="text-green-600">综合: {chunk.final_score.toFixed(3)}</span>
                              <span className="text-blue-600">向量: {chunk.vector_score.toFixed(3)}</span>
                              <span className="text-orange-600">BM25: {chunk.bm25_score.toFixed(3)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
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
                    const otherNode = relatedNodes.get(otherNodeId)
                    const otherNodeName = otherNode?.name || otherNodeId.substring(0, 8)

                    return (
                      <button
                        key={edge.id}
                        onClick={() => otherNode && handleRelatedNodeClick(otherNode)}
                        disabled={!otherNode}
                        className={cn(
                          'flex items-center gap-2 text-sm bg-muted/50 rounded-md p-2 w-full text-left',
                          otherNode && 'hover:bg-muted cursor-pointer transition-colors',
                          !otherNode && 'opacity-70 cursor-not-allowed'
                        )}
                      >
                        <BookOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">
                          <span className="font-medium">{edge.relation_type}</span>
                          {' to '}
                          <span className="text-primary">{otherNodeName}</span>
                        </span>
                      </button>
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