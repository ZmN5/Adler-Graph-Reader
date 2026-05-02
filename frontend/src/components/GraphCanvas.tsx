import { useCallback, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { GraphNode } from '@/lib/api-client'
import { useGraphCanvas } from '@/hooks/useGraphCanvas'
import { createNodeCanvasObject, createLinkCanvasObject } from './graph/canvasRenderers'
import ForceGraph2D, { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import type { ExtendedNode, ExtendedLink } from '@/hooks/useGraphCanvas'

interface GraphCanvasProps {
  bookId: string
  className?: string
  onNodeClick?: (node: GraphNode | null) => void
  selectedNodeId?: string | null
}

export function GraphCanvas({
  bookId,
  className,
  onNodeClick,
  selectedNodeId,
}: GraphCanvasProps) {
  const {
    t,
    graphData,
    isLoading,
    error,
    hoveredNode,
    selectedCategories,
    searchQuery,
    showOnlyCore,
    tooltip,
    dimensions,
    setDimensions,
    pulseTimeObj,
    allCategories,
    visibleNodes,
    visibleLinks,
    visibleGraphData,
    hasMoreNodes,
    handleLoadMore,
    toggleCategory,
    clearCategoryFilter,
    handleNodeHover,
    setSearchQuery,
    setShowOnlyCore,
  } = useGraphCanvas(bookId)

  const graphRef = useRef<ForceGraphMethods<ExtendedNode, ExtendedLink> | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [setDimensions])

  // Pulse animation for core concepts - uses mutable object to avoid React re-renders
  useEffect(() => {
    let animationId: number
    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      pulseTimeObj.current.current = elapsed / 1000
      // Force graph redraw via internal method
      const graph = graphRef.current as unknown as { refresh?: () => void } | undefined
      graph?.refresh?.()
      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => cancelAnimationFrame(animationId)
  }, [pulseTimeObj])

  // Center on selected node
  useEffect(() => {
    if (selectedNodeId && graphRef.current) {
      const timeoutId = setTimeout(() => {
        graphRef.current?.centerAt(0, 0, 500)
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [selectedNodeId])

  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const extNode = node as ExtendedNode
      const graphNode: GraphNode = {
        id: extNode.id,
        name: extNode.name,
        description: extNode.description,
        examples: extNode.examples,
        source_chunk_ids: extNode.source_chunk_ids,
        is_core: extNode.is_core,
      }
      onNodeClick?.(graphNode)
    },
    [onNodeClick]
  )

  const handleNodeHoverWrapped = useCallback((node: NodeObject | null) => {
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab'
    }
    handleNodeHover(node)
  }, [handleNodeHover])

  const nodeCanvasObject = createNodeCanvasObject(selectedNodeId, hoveredNode, pulseTimeObj.current)
  const linkCanvasObject = createLinkCanvasObject(selectedNodeId, hoveredNode)

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
        <span className="ml-3 text-gray-500 font-sans">Loading graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-red-500', className)}>
        <p className="text-red-500">Failed to load graph</p>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-gray-500', className)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="h-16 w-16 opacity-40 text-gray-400">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
        <p className="mt-4 text-gray-600 font-sans">No concepts extracted yet</p>
        <p className="text-sm text-gray-400 mt-1">Extract concepts from your book to build the graph</p>
      </div>
    )
  }

  const coreConceptCount = visibleNodes.filter((n) => n.is_core).length

  return (
    <div ref={containerRef} className={cn('relative h-full w-full', className)}>
      <ForceGraph2D
        ref={graphRef}
        graphData={visibleGraphData as { nodes: ExtendedNode[]; links: ExtendedLink[] }}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHoverWrapped}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        backgroundColor="transparent"
        linkDirectionalArrowLength={0}
        cooldownTicks={50}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.4}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-white border border-gray-200 rounded-xl px-3 py-2 z-10 max-w-[200px] shadow-apple-lg"
          style={{
            left: Math.min(tooltip.x + 15, dimensions.width - 220),
            top: Math.max(tooltip.y - 60, 10),
            transform: 'translateY(-100%)',
          }}
        >
          <div className="font-sans font-medium text-sm text-gray-900">{tooltip.node.name}</div>
          {tooltip.node.category && (
            <div className="text-xs text-apple-blue mt-0.5">
              {tooltip.node.category}
            </div>
          )}
          {tooltip.node.is_core && (
            <div className="text-xs text-apple-purple mt-0.5 font-medium">Core Concept</div>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="absolute bottom-3 left-3 text-xs text-gray-500 bg-white/85 backdrop-blur-md px-3 py-2 rounded-xl border border-gray-200 flex flex-col gap-1 font-sans shadow-apple-sm">
        <span>{visibleNodes.length} / {graphData.nodes.length} nodes visible</span>
        <span>{visibleLinks.length} connections</span>
        {hasMoreNodes && (
          <button
            onClick={handleLoadMore}
            className="mt-1 px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 rounded-lg text-xs hover:bg-blue-100 transition-colors"
          >
            {t('graph.expand')} (+{Math.min(50, graphData.nodes.length - visibleNodes.length)})
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl px-4 py-3 max-w-[200px] shadow-apple-sm">
        <div className="text-xs font-sans font-medium text-apple-blue mb-2">{t('graph.legend')}</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-apple-blue shadow-sm" />
            <span className="text-xs text-gray-600 font-sans">
              Core Concept ({coreConceptCount})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-apple-indigo" />
            <span className="text-xs text-gray-500 font-sans">Philosophy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-apple-green" />
            <span className="text-xs text-gray-500 font-sans">Science</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-apple-teal" />
            <span className="text-xs text-gray-500 font-sans">Technology</span>
          </div>
        </div>
      </div>

      {/* Search box */}
      <div className="absolute top-3 left-3 bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl px-3 py-2 z-20 shadow-apple-sm">
        <div className="text-xs font-sans font-medium text-apple-blue mb-2">Search</div>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className={cn(
              'w-[180px] px-2 py-1 text-xs rounded-lg font-sans',
              'bg-white border border-gray-300',
              'text-gray-700 placeholder:text-gray-400',
              'focus:outline-none focus:border-apple-blue',
              'transition-colors'
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 text-xs"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Category filters */}
      {allCategories.length > 0 && (
        <div className="absolute top-[75px] left-3 bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl px-3 py-2 z-10 shadow-apple-sm">
          <div className="text-xs font-sans font-medium text-apple-blue mb-2">{t('graph.filter')}</div>
          <div className="flex flex-wrap gap-1 max-w-[180px]">
            {allCategories.slice(0, 6).map((category) => (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded-lg font-sans transition-all',
                  selectedCategories.has(category)
                    ? 'bg-blue-50 border border-blue-300 text-blue-600'
                    : 'bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-900'
                )}
              >
                {category}
              </button>
            ))}
            {selectedCategories.size > 0 && (
              <button
                onClick={clearCategoryFilter}
                className="px-2 py-0.5 text-xs rounded-lg font-sans text-red-500 hover:text-red-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Core concepts toggle */}
      <div className="absolute left-3 top-[110px] bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl px-3 py-2 shadow-apple-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyCore}
            onChange={(e) => setShowOnlyCore(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 bg-white text-apple-blue focus:ring-apple-blue/30"
          />
          <span className="text-xs text-gray-600 font-sans">Core only</span>
        </label>
      </div>
    </div>
  )
}
