import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getBookGraph, GraphNode } from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
import {
  PLANET_COLORS,
  CORE_COLOR,
  DEFAULT_PLANET_COLOR,
  lightenColor,
  darkenColor,
} from '@/lib/graph-utils'
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'

const INITIAL_NODE_LIMIT = 50
const NODE_INCREMENT = 50

interface GraphCanvasProps {
  bookId: string
  className?: string
  onNodeClick?: (node: GraphNode | null) => void
  selectedNodeId?: string | null
}

interface GraphData {
  nodes: GraphNode[]
  links: {
    id: string
    source: string
    target: string
    relation_type: string
  }[]
}

interface ExtendedNode extends NodeObject {
  id: string
  name: string
  description: string
  examples: string[]
  source_chunk_ids: string[]
  is_core: boolean
  category?: string
  pulsePhase?: number
}

interface ExtendedLink extends LinkObject {
  id: string
  source: string | ExtendedNode
  target: string | ExtendedNode
  relation_type: string
}

export function GraphCanvas({
  bookId,
  className,
  onNodeClick,
  selectedNodeId,
}: GraphCanvasProps) {
  const { t } = useTranslation()
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<ExtendedNode | null>(null)
  const [visibleNodeCount, setVisibleNodeCount] = useState(INITIAL_NODE_LIMIT)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showOnlyCore, setShowOnlyCore] = useState(false)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: ExtendedNode } | null>(null)
  const graphRef = useRef<ForceGraphMethods<ExtendedNode, ExtendedLink> | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const pulseTimeRef = useRef(0)

  // Load graph data
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setVisibleNodeCount(INITIAL_NODE_LIMIT)

    const loadGraph = async () => {
      try {
        const data = await getBookGraph(bookId)
        if (!cancelled) {
          // Sort nodes by importance (core first, then by source_chunk_ids count)
          const sortedNodes = [...data.nodes].sort((a, b) => {
            if (a.is_core !== b.is_core) return b.is_core ? 1 : -1
            return b.source_chunk_ids.length - a.source_chunk_ids.length
          })

          // Transform edges to links format expected by force-graph
          setGraphData({
            nodes: sortedNodes,
            links: data.edges.map((edge) => ({
              id: edge.id,
              source: edge.source_node_id,
              target: edge.target_node_id,
              relation_type: edge.relation_type,
            })),
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load graph')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadGraph()

    return () => {
      cancelled = true
    }
  }, [bookId])

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
  }, [])

  // Pulse animation for core concepts - uses ref to avoid React re-renders
  useEffect(() => {
    let animationId: number
    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      pulseTimeRef.current = elapsed / 1000
      // Force graph redraw via internal method
      const graph = graphRef.current as unknown as { refresh?: () => void } | undefined
      graph?.refresh?.()
      animationId = requestAnimationFrame(animate)
    }
    animate()

    return () => cancelAnimationFrame(animationId)
  }, [])

  // Get all unique categories from nodes
  const allCategories = useMemo(() => {
    const categories = new Set<string>()
    graphData.nodes.forEach((node) => {
      if (node.category) {
        categories.add(node.category)
      }
    })
    return Array.from(categories).sort()
  }, [graphData.nodes])

  // Memoized visible nodes and links for performance
  const visibleNodes = useMemo(() => {
    let nodes = graphData.nodes.slice(0, visibleNodeCount)

    // Filter by core concept only
    if (showOnlyCore) {
      nodes = nodes.filter((node) => node.is_core)
    }

    // Filter by selected categories if any
    if (selectedCategories.size > 0) {
      nodes = nodes.filter((node) => node.category && selectedCategories.has(node.category))
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      nodes = nodes.filter((node) =>
        node.name.toLowerCase().includes(query) ||
        node.description.toLowerCase().includes(query)
      )
    }

    return nodes
  }, [graphData.nodes, visibleNodeCount, selectedCategories, searchQuery, showOnlyCore])

  const visibleNodeIds = useMemo(() => {
    return new Set(visibleNodes.map((n) => n.id))
  }, [visibleNodes])

  const visibleLinks = useMemo(() => {
    // Only show links where both source and target are visible
    return graphData.links.filter(
      (link) => visibleNodeIds.has(link.source as string) && visibleNodeIds.has(link.target as string)
    )
  }, [graphData.links, visibleNodeIds])

  const visibleGraphData = useMemo(() => ({
    nodes: visibleNodes,
    links: visibleLinks,
  }), [visibleNodes, visibleLinks])

  const hasMoreNodes = graphData.nodes.length > visibleNodeCount

  const handleLoadMore = useCallback(() => {
    setVisibleNodeCount((prev) => Math.min(prev + NODE_INCREMENT, graphData.nodes.length))
  }, [graphData.nodes.length])

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(category)) {
        newSet.delete(category)
      } else {
        newSet.add(category)
      }
      return newSet
    })
  }, [])

  const clearCategoryFilter = useCallback(() => {
    setSelectedCategories(new Set())
  }, [])

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

  const handleNodeHover = useCallback((node: NodeObject | null) => {
    const extNode = node as ExtendedNode | null
    setHoveredNode(extNode)
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab'
    }
    // Update tooltip
    if (extNode && extNode.x !== undefined && extNode.y !== undefined) {
      setTooltip({
        x: extNode.x,
        y: extNode.y,
        node: extNode,
      })
    } else {
      setTooltip(null)
    }
  }, [])

  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      // Guard: skip nodes without valid position
      if (node.x === undefined || node.y === undefined ||
          !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        return
      }

      const extNode = node as ExtendedNode
      const label = extNode.name
      const shortLabel = label.length > 15 ? label.substring(0, 12) + '...' : label

      // Minimum node size (increased for better clickability)
      const MIN_NODE_SIZE = 6
      const MAX_NODE_SIZE = 22

      // Calculate node size based on source_chunk_ids count
      const sizeMultiplier = extNode.is_core ? 1.8 : 1.2
      const baseSize = Math.min(
        MIN_NODE_SIZE + extNode.source_chunk_ids.length * 0.6,
        MAX_NODE_SIZE
      )
      const nodeSize = baseSize * sizeMultiplier

      // Hover effect: increase size when hovered
      const isSelected = extNode.id === selectedNodeId
      const isHovered = extNode.id === hoveredNode?.id
      const displaySize = isHovered ? nodeSize * 1.2 : nodeSize

      // Get planet color based on category or core status
      let planetColor = DEFAULT_PLANET_COLOR
      if (extNode.is_core) {
        planetColor = CORE_COLOR
      } else if (extNode.category && PLANET_COLORS[extNode.category]) {
        planetColor = PLANET_COLORS[extNode.category]
      }

      // Pulse animation for core concepts
      const pulseScale = extNode.is_core ? 1 + Math.sin(pulseTimeRef.current * 2) * 0.08 : 1
      const finalSize = displaySize * pulseScale

      // Draw planetary glow/atmosphere for core concepts
      if (extNode.is_core) {
        const glowIntensity = 0.3 + Math.sin(pulseTimeRef.current * 2) * 0.2
        const glowRadius = finalSize * (2.5 + Math.sin(pulseTimeRef.current * 1.5) * 0.5)
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, finalSize * 0.8,
          node.x, node.y, glowRadius
        )
        glowGradient.addColorStop(0, planetColor.atmosphere.replace(/[\d.]+\)$/, `${glowIntensity})`))
        glowGradient.addColorStop(0.5, planetColor.atmosphere.replace(/[\d.]+\)$/, `${glowIntensity * 0.4})`))
        glowGradient.addColorStop(1, 'rgba(0, 122, 255, 0)')
        ctx.fillStyle = glowGradient
        ctx.beginPath()
        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI)
        ctx.fill()
      }

      // Draw hover glow for all nodes
      if (isHovered) {
        const hoverGlowGradient = ctx.createRadialGradient(
          node.x, node.y, finalSize * 0.5,
          node.x, node.y, finalSize * 2
        )
        hoverGlowGradient.addColorStop(0, `${planetColor.atmosphere}`)
        hoverGlowGradient.addColorStop(1, 'transparent')
        ctx.fillStyle = hoverGlowGradient
        ctx.beginPath()
        ctx.arc(node.x, node.y, finalSize * 2, 0, 2 * Math.PI)
        ctx.fill()
      }

      // Draw planet body with gradient
      const bodyGradient = ctx.createRadialGradient(
        node.x - finalSize * 0.3, node.y - finalSize * 0.3, 0,
        node.x, node.y, finalSize
      )
      bodyGradient.addColorStop(0, lightenColor(planetColor.base, 40))
      bodyGradient.addColorStop(0.5, planetColor.base)
      bodyGradient.addColorStop(1, darkenColor(planetColor.base, 30))

      ctx.beginPath()
      ctx.arc(node.x, node.y, finalSize, 0, 2 * Math.PI)
      ctx.fillStyle = bodyGradient
      ctx.fill()

      // Draw planetary ring for core concepts
      if (extNode.is_core && (isHovered || isSelected)) {
        ctx.save()
        ctx.translate(node.x, node.y)
        ctx.scale(1, 0.3)
        ctx.beginPath()
        ctx.arc(0, 0, finalSize * 1.8, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0, 122, 255, ${isSelected ? 0.7 : 0.4})`
        ctx.lineWidth = 2 / globalScale
        ctx.stroke()
        ctx.restore()
      }

      // Draw selection border
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, finalSize + 3 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = '#007AFF'
        ctx.lineWidth = 2 / globalScale
        ctx.stroke()

        // Selection glow
        const selectionGlow = ctx.createRadialGradient(
          node.x, node.y, finalSize,
          node.x, node.y, finalSize + 8 / globalScale
        )
        selectionGlow.addColorStop(0, 'rgba(0, 122, 255, 0.5)')
        selectionGlow.addColorStop(1, 'rgba(0, 122, 255, 0)')
        ctx.fillStyle = selectionGlow
        ctx.fill()
      } else if (isHovered || extNode.is_core) {
        // Normal hover or core border
        ctx.beginPath()
        ctx.arc(node.x, node.y, finalSize + 2 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = extNode.is_core ? planetColor.glow : 'rgba(100, 116, 139, 0.5)'
        ctx.lineWidth = extNode.is_core ? 2 / globalScale : 1.5 / globalScale
        ctx.stroke()
      }

      // Draw specular highlight (shine)
      const highlightGradient = ctx.createRadialGradient(
        node.x - finalSize * 0.4, node.y - finalSize * 0.4, 0,
        node.x - finalSize * 0.4, node.y - finalSize * 0.4, finalSize * 0.6
      )
      highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
      highlightGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = highlightGradient
      ctx.beginPath()
      ctx.arc(node.x, node.y, finalSize, 0, 2 * Math.PI)
      ctx.fill()

      // Draw label based on zoom level
      if (globalScale >= 0.3) {
        const MAX_FONT_SIZE = 14
        const fontSize = globalScale >= 0.8
          ? Math.min(12 / globalScale, MAX_FONT_SIZE)
          : Math.min(10 / globalScale, MAX_FONT_SIZE)

        const labelText = globalScale >= 0.8 ? label : shortLabel

        // Draw label background
        ctx.font = extNode.is_core ? `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif` : `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
        const textMetrics = ctx.measureText(labelText)
        const padding = 4 / globalScale
        const labelWidth = textMetrics.width + padding * 2
        const labelHeight = fontSize + padding * 2

        // Label background - white for light theme
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.beginPath()
        ctx.roundRect(
          node.x! - labelWidth / 2,
          node.y! + finalSize + 4 / globalScale,
          labelWidth,
          labelHeight,
          6 / globalScale
        )
        ctx.fill()

        // Label border glow for core concepts
        if (extNode.is_core) {
          ctx.strokeStyle = 'rgba(0, 122, 255, 0.3)'
          ctx.lineWidth = 1 / globalScale
          ctx.stroke()
        }

        // Draw label text
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = extNode.is_core ? '#007AFF' : '#0F172A'

        // Text shadow for better readability
        ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
        ctx.shadowBlur = 4
        ctx.fillText(labelText, node.x!, node.y! + finalSize + 4 / globalScale + labelHeight / 2)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }
    },
    [selectedNodeId, hoveredNode]
  )

  const linkCanvasObject = useCallback(
    (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const extLink = link as ExtendedLink
      const source = link.source as NodeObject
      const target = link.target as NodeObject

      if (!source.x || !source.y || !target.x || !target.y) return

      // Get source and target colors for gradient
      const sourceNode = source as ExtendedNode
      const targetNode = target as ExtendedNode

      let sourceColor = DEFAULT_PLANET_COLOR.base
      let targetColor = DEFAULT_PLANET_COLOR.base

      if (sourceNode.is_core) sourceColor = CORE_COLOR.base
      else if (sourceNode.category && PLANET_COLORS[sourceNode.category]) {
        sourceColor = PLANET_COLORS[sourceNode.category].base
      }

      if (targetNode.is_core) targetColor = CORE_COLOR.base
      else if (targetNode.category && PLANET_COLORS[targetNode.category]) {
        targetColor = PLANET_COLORS[targetNode.category].base
      }

      // Check if link is connected to selected or hovered node
      const isHighlighted =
        selectedNodeId === sourceNode.id ||
        selectedNodeId === targetNode.id ||
        hoveredNode?.id === sourceNode.id ||
        hoveredNode?.id === targetNode.id

      // Draw cosmic connection with gradient
      const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y)
      gradient.addColorStop(0, `${sourceColor}80`)
      gradient.addColorStop(0.5, isHighlighted ? 'rgba(0, 122, 255, 0.6)' : 'rgba(150, 170, 200, 0.3)')
      gradient.addColorStop(1, `${targetColor}80`)

      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.strokeStyle = gradient
      ctx.lineWidth = isHighlighted ? 1.5 / globalScale : 0.5 / globalScale
      ctx.setLineDash(isHighlighted ? [] : [4, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Draw animated particles on highlighted links
      if (isHighlighted && globalScale >= 0.5) {
        const particleCount = 3
        const time = Date.now() / 1000

        for (let i = 0; i < particleCount; i++) {
          const t = ((time * 0.5 + i / particleCount) % 1)
          const px = source.x + (target.x - source.x) * t
          const py = source.y + (target.y - source.y) * t

          const particleGradient = ctx.createRadialGradient(px, py, 0, px, py, 4 / globalScale)
          particleGradient.addColorStop(0, 'rgba(0, 122, 255, 0.8)')
          particleGradient.addColorStop(1, 'transparent')

          ctx.beginPath()
          ctx.arc(px, py, 4 / globalScale, 0, 2 * Math.PI)
          ctx.fillStyle = particleGradient
          ctx.fill()
        }
      }

      // Draw relation type label at midpoint (only when highlighted)
      if (isHighlighted && globalScale >= 0.6 && extLink.relation_type) {
        const midX = (source.x + target.x) / 2
        const midY = (source.y + target.y) / 2
        const fontSize = Math.max(8 / globalScale, 3)

        // Background for label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.beginPath()
        ctx.roundRect(midX - 20, midY - 8, 40, 16, 4)
        ctx.fill()

        ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#007AFF'
        ctx.fillText(extLink.relation_type, midX, midY)
      }
    },
    [selectedNodeId, hoveredNode]
  )

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
        onNodeHover={handleNodeHover}
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
            {t('graph.expand')} (+{Math.min(NODE_INCREMENT, graphData.nodes.length - visibleNodeCount)})
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
