import { cn } from '@/lib/utils'
import { BookOpen } from 'lucide-react'
import type { NodeEdgesProps } from './types'

export function NodeEdges({
  edges,
  currentNodeId,
  relatedNodes,
  onRelatedNodeClick,
}: NodeEdgesProps) {
  if (edges.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-sans font-medium text-gray-500 mb-3">
        Related Concepts ({edges.length})
      </h3>
      <div className="space-y-2">
        {edges.map((edge) => {
          const isSource = edge.source_node_id === currentNodeId
          const otherNodeId = isSource ? edge.target_node_id : edge.source_node_id
          const otherNode = relatedNodes.get(otherNodeId)
          const otherNodeName = otherNode?.name || otherNodeId.substring(0, 8)

          return (
            <button
              key={edge.id}
              onClick={() => otherNode && onRelatedNodeClick(otherNode)}
              disabled={!otherNode}
              className={cn(
                'flex items-center gap-2 text-sm bg-slate-50 rounded-lg p-2 w-full text-left font-sans',
                otherNode && 'hover:bg-gray-100 border border-gray-200 cursor-pointer transition-colors',
                !otherNode && 'opacity-70 cursor-not-allowed'
              )}
            >
              <BookOpen className="h-4 w-4 flex-shrink-0 text-apple-purple" />
              <span className="flex-1 truncate">
                <span className="text-gray-600">{edge.relation_type}</span>
                {' → '}
                <span className="text-apple-blue">{otherNodeName}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
