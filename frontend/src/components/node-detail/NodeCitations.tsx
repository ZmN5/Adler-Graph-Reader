import { cn } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import type { NodeCitationsProps } from './types'

export function NodeCitations({
  sourceChunkIds,
  chunkContents,
  loadingChunks,
  onCitationClick,
}: NodeCitationsProps) {
  const { t } = useTranslation()

  if (sourceChunkIds.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-sans font-medium text-gray-500 mb-2">
        <span className="text-apple-blue">⬡</span> {t('nodeDetail.sourceCitations')} ({sourceChunkIds.length})
      </h3>
      <div className="space-y-1">
        {sourceChunkIds.slice(0, 10).map((chunkId) => {
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
              onClick={() => onCitationClick(chunkId)}
              className={cn(
                'flex items-center gap-2 w-full text-left text-sm rounded-lg px-2 py-1.5 font-sans',
                'hover:bg-gray-100 transition-colors text-blue-600 hover:text-blue-700'
              )}
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              <span className="truncate" title={chunk?.content || chunkId}>
                {summary}
              </span>
            </button>
          )
        })}
        {sourceChunkIds.length > 10 && (
          <p className="text-xs text-gray-400 pl-2 font-sans">
            +{sourceChunkIds.length - 10} more citations
          </p>
        )}
      </div>
    </div>
  )
}
