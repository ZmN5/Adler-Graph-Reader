import { Sparkles } from 'lucide-react'
import type { NodeContextBannerProps } from './types'

export function NodeContextBanner({
  nodeContext,
  onAskAboutNode,
  onDismiss,
}: NodeContextBannerProps) {
  if (!nodeContext) return null

  return (
    <div className="flex-shrink-0 mx-4 mb-2 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
      <Sparkles className="h-4 w-4 text-apple-blue flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700">
          已选中节点
          <span className="font-medium text-apple-blue">「{nodeContext.name}」</span>
        </p>
      </div>
      <button
        onClick={onAskAboutNode}
        className="text-sm px-3 py-1.5 bg-apple-blue text-white rounded-lg hover:bg-blue-600 transition-colors flex-shrink-0"
      >
        询问
      </button>
      <button
        onClick={onDismiss}
        className="text-sm px-2 py-1.5 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
      >
        忽略
      </button>
    </div>
  )
}
