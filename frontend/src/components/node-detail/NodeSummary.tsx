import { cn } from '@/lib/utils'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import type { NodeSummaryProps } from './types'

export function NodeSummary({
  summaryLoading,
  isStreaming,
  streamingText,
  streamingCitations,
  summary,
  summaryError,
  onRetrySummary,
  onCitationClick,
  renderSummaryWithCitations,
}: NodeSummaryProps) {
  const { t } = useTranslation()

  const citations = streamingCitations.length > 0 ? streamingCitations : (summary?.citations || [])

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-slate-50">
        <Sparkles className="h-4 w-4 text-apple-blue" />
        <h3 className="text-sm font-sans font-medium text-gray-700">{t('nodeDetail.aiAnalysis')}</h3>
      </div>
      <div className="p-4">
        {(summaryLoading || isStreaming) && streamingText === '' && (
          <div className="flex items-center gap-3 py-4">
            <div className="h-5 w-5 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
            <span className="text-sm text-gray-500 font-sans">{t('nodeDetail.scanning')}</span>
          </div>
        )}

        {summaryError && (
          <div className="py-4">
            <p className="text-sm text-red-500 mb-3 font-sans">{summaryError}</p>
            <button
              onClick={onRetrySummary}
              className={cn(
                'flex items-center gap-2 text-sm px-3 py-2 rounded-lg font-sans',
                'bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors'
              )}
            >
              <RefreshCw className="h-4 w-4" />
              {t('nodeDetail.retry')}
            </button>
          </div>
        )}

        {((!summaryLoading && summary) || streamingText !== '') && (
          <div className="space-y-4">
            {/* Summary Text - use streaming text or static summary */}
            <div className="text-sm leading-relaxed text-gray-700 font-sans">
              {streamingText !== '' ? (
                renderSummaryWithCitations(streamingText)
              ) : summary ? (
                renderSummaryWithCitations(summary.summary)
              ) : null}
            </div>

            {/* Citations List - use streaming citations or static citations */}
            {(streamingCitations.length > 0 || (summary && summary.citations.length > 0)) && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <h4 className="text-xs font-sans font-medium text-gray-500 mb-2">Sources</h4>
                <div className="space-y-2">
                  {citations.map((citation) => (
                    <button
                      key={citation.index}
                      onClick={() => onCitationClick(citation.chunk_id)}
                      className={cn(
                        'w-full text-left text-xs p-3 rounded-lg font-sans',
                        'bg-slate-50 hover:bg-gray-100 border border-gray-200 transition-colors'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium border border-blue-200">
                          [{citation.index}]
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-600 line-clamp-2">
                            {citation.excerpt}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1">
                            Page {citation.page_start}{citation.page_start !== citation.page_end ? `-${citation.page_end}` : ''}
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
  )
}
