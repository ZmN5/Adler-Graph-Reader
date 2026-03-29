import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { GraphNode, getCoreConcepts, getNode, NodeDetails } from '@/lib/api-client'
import { Star, FileText, Sparkles } from 'lucide-react'

interface CoreConceptsListProps {
  bookId: string
  className?: string
  onNodeClick?: (node: GraphNode) => void
  onViewInBook?: (pageNumber: number) => void
  bookFormat?: 'pdf' | 'epub'
}

export function CoreConceptsList({
  bookId,
  className,
  onNodeClick,
  onViewInBook,
  bookFormat = 'pdf',
}: CoreConceptsListProps) {
  const [coreConcepts, setCoreConcepts] = useState<GraphNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeDetails>>({})
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    const loadCoreConcepts = async () => {
      try {
        const concepts = await getCoreConcepts(bookId)
        if (!cancelled) {
          // Defensive check: ensure concepts is an array
          const conceptsArray = Array.isArray(concepts) ? concepts : []
          setCoreConcepts(conceptsArray)
          // Load details for each concept to get page numbers
          conceptsArray.forEach((concept) => {
            loadNodeDetails(concept.id)
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load core concepts')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadCoreConcepts()

    return () => {
      cancelled = true
    }
  }, [bookId])

  const loadNodeDetails = useCallback(async (nodeId: string) => {
    setLoadingDetails((prev) => ({ ...prev, [nodeId]: true }))
    try {
      const details = await getNode(nodeId)
      setNodeDetails((prev) => ({ ...prev, [nodeId]: details }))
    } catch (err) {
      console.error('Failed to load node details:', err)
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [nodeId]: false }))
    }
  }, [])

  const handleConceptClick = useCallback(
    (concept: GraphNode) => {
      onNodeClick?.(concept)
    },
    [onNodeClick]
  )

  const handleViewInBook = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation()
      const details = nodeDetails[nodeId]
      if (details?.page_number && onViewInBook) {
        onViewInBook(details.page_number)
      }
    },
    [nodeDetails, onViewInBook]
  )

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="ml-3 text-muted-foreground">Loading core concepts...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('text-center text-destructive py-8', className)}>
        <p>{error}</p>
      </div>
    )
  }

  if (coreConcepts.length === 0) {
    return (
      <div className={cn('text-center text-muted-foreground py-12', className)}>
        <Sparkles className="mx-auto h-12 w-12 opacity-50" />
        <p className="mt-4">No core concepts yet</p>
        <p className="text-sm mt-1">Extract concepts from this book to see core concepts here</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 mb-4">
        <Star className="h-5 w-5 text-purple-500 fill-purple-500" />
        <h2 className="text-lg font-semibold">Core Concepts</h2>
        <span className="text-sm text-muted-foreground">({coreConcepts.length})</span>
      </div>

      <div className="grid gap-3">
        {coreConcepts.map((concept) => {
          const details = nodeDetails[concept.id]
          const hasPageNumber = details?.page_number && details.page_number > 0

          return (
            <div
              key={concept.id}
              onClick={() => handleConceptClick(concept)}
              className={cn(
                'group rounded-lg border bg-card p-4 transition-colors',
                'hover:bg-muted/50 cursor-pointer'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-purple-500 fill-purple-500 flex-shrink-0" />
                    <h3 className="font-medium truncate">{concept.name}</h3>
                  </div>

                  {concept.description && (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                      {concept.description}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    {hasPageNumber && (
                      <span className="text-xs text-muted-foreground">
                        {bookFormat === 'epub' ? `Chapter ${details.page_number}` : `Page ${details.page_number}`}
                      </span>
                    )}

                    {loadingDetails[concept.id] && (
                      <span className="text-xs text-muted-foreground">Loading...</span>
                    )}
                  </div>
                </div>

                {hasPageNumber && onViewInBook && (
                  <button
                    onClick={(e) => handleViewInBook(e, concept.id)}
                    className={cn(
                      'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md',
                      'bg-primary text-primary-foreground hover:bg-primary/90',
                      'transition-colors flex-shrink-0'
                    )}
                    title={`View on ${bookFormat === 'epub' ? 'chapter' : 'page'} ${details.page_number}`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    View
                  </button>
                )}
              </div>

              {concept.examples && concept.examples.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Examples:</p>
                  <ul className="space-y-1">
                    {concept.examples.slice(0, 2).map((example, idx) => (
                      <li key={idx} className="text-xs text-muted-foreground line-clamp-1">
                        • {example}
                      </li>
                    ))}
                    {concept.examples.length > 2 && (
                      <li className="text-xs text-muted-foreground">
                        +{concept.examples.length - 2} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
