import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { NodeRetrievalProps } from './types'

export function NodeRetrieval({
  retrievalResults,
  onCitationClick,
}: NodeRetrievalProps) {
  const [showDetails, setShowDetails] = useState(false)

  const sortedChunks = retrievalResults?.chunks
    ? [...retrievalResults.chunks].sort((a, b) => b.final_score - a.final_score)
    : []

  if (sortedChunks.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors border-b border-gray-200"
      >
        <h3 className="text-sm font-sans font-medium text-gray-700">Retrieval Details</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-sans">
            {sortedChunks.length} related chunks
          </span>
          {showDetails ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {showDetails && (
        <div className="p-4 space-y-3">
          {sortedChunks.map((chunk, index) => (
            <button
              key={chunk.chunk_id}
              onClick={() => onCitationClick(chunk.chunk_id)}
              className={cn(
                'w-full text-left p-3 rounded-lg font-sans',
                'bg-slate-50 hover:bg-gray-100 border border-gray-200 transition-colors'
              )}
            >
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 text-xs text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                  #{index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 line-clamp-3 mb-2">
                    {chunk.content}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-sans">
                    <span className="text-gray-400">Page {chunk.page_start}-{chunk.page_end}</span>
                    <span className="text-green-600">Score: {chunk.final_score.toFixed(3)}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
