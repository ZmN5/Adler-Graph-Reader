import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { GraphNode, getCoreConcepts, getNode, NodeDetails } from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
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
  const { t } = useTranslation()
  const [coreConcepts, setCoreConcepts] = useState<GraphNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeDetails>>({})
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({})

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
  }, [bookId, loadNodeDetails])

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
        <div className="h-8 w-8 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
        <span className="ml-3 text-gray-500 font-sans">{t('coreConcepts.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('text-center text-red-500 py-8 font-sans', className)}>
        <p>{error}</p>
      </div>
    )
  }

  if (coreConcepts.length === 0) {
    return (
      <div className={cn('text-center text-gray-500 py-12', className)}>
        <div className="relative">
          <Sparkles className="mx-auto h-16 w-16 text-gray-300" />
        </div>
        <p className="mt-4 text-gray-600 font-sans">{t('coreConcepts.empty')}</p>
        <p className="text-sm text-gray-400 mt-1 font-sans">{t('coreConcepts.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <Star className="h-6 w-6 text-apple-blue" />
        </div>
        <h2 className="text-xl font-sans font-bold text-gray-900">{t('coreConcepts.title')}</h2>
        <span className="apple-badge apple-badge-blue">({coreConcepts.length})</span>
      </div>

      <div className="grid gap-4">
        {coreConcepts.map((concept) => {
          const details = nodeDetails[concept.id]
          const hasPageNumber = details?.page_number && details.page_number > 0

          return (
            <div
              key={concept.id}
              onClick={() => handleConceptClick(concept)}
              className={cn(
                'group rounded-xl border bg-white p-5 transition-all cursor-pointer',
                'hover:border-gray-300 hover:shadow-apple-md hover:bg-slate-50',
                'border-gray-200'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Star className="h-5 w-5 text-apple-blue fill-apple-blue" />
                    </div>
                    <h3 className="font-sans font-semibold text-lg text-gray-900 truncate">{concept.name}</h3>
                  </div>

                  {concept.description && (
                    <p className="mt-3 text-sm text-gray-600 line-clamp-2 font-sans leading-relaxed">
                      {concept.description}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-4">
                    {hasPageNumber && (
                      <span className="text-xs text-gray-400 font-sans flex items-center gap-1">
                        <span className="text-apple-purple">◆</span>
                        {bookFormat === 'epub' ? `${t('nodeDetail.chapter')} ${details.page_number}` : `${t('nodeDetail.page')} ${details.page_number}`}
                      </span>
                    )}

                    {loadingDetails[concept.id] && (
                      <span className="text-xs text-gray-400 font-sans flex items-center gap-1">
                        <div className="h-2 w-2 border border-gray-300 border-t-apple-blue rounded-full animate-spin" />
                        {t('common.loading')}
                      </span>
                    )}

                    <span className="text-xs text-apple-blue/70 font-sans">
                      {concept.source_chunk_ids.length} {t('coreConcepts.references')}
                    </span>
                  </div>
                </div>

                {hasPageNumber && onViewInBook && (
                  <button
                    onClick={(e) => handleViewInBook(e, concept.id)}
                    className={cn(
                      'flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-sans flex-shrink-0',
                      'bg-blue-50 border border-blue-200 text-blue-600',
                      'hover:bg-blue-100 hover:border-blue-300 transition-all'
                    )}
                    title={`View on ${bookFormat === 'epub' ? 'chapter' : 'page'} ${details.page_number}`}
                  >
                    <FileText className="h-4 w-4" />
                    {t('coreConcepts.view')}
                  </button>
                )}
              </div>

              {concept.examples && concept.examples.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-400 mb-2 font-sans uppercase tracking-wider">{t('coreConcepts.examples')}</p>
                  <ul className="space-y-1.5">
                    {concept.examples.slice(0, 2).map((example, idx) => (
                      <li key={idx} className="text-xs text-gray-500 line-clamp-1 font-sans flex items-start gap-2">
                        <span className="text-apple-purple/60 mt-0.5">→</span>
                        <span>{example}</span>
                      </li>
                    ))}
                    {concept.examples.length > 2 && (
                      <li className="text-xs text-gray-400 font-sans">
                        +{concept.examples.length - 2} more examples
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
