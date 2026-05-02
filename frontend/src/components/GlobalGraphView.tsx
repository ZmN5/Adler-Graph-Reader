import { useState, useCallback, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { getGlobalGraph, GraphNode } from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
import {
  PLANET_COLORS,
  CORE_COLOR,
  DEFAULT_PLANET_COLOR,
  lightenColor,
  darkenColor,
} from '@/lib/graph-utils'
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'

interface GlobalGraphViewProps {
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
  sourceCount: number
  is_core: boolean
  category?: string
}

interface ExtendedLink extends LinkObject {
  id: string
  source: string | ExtendedNode
  target: string | ExtendedNode
  relation_type: string
}

export function GlobalGraphView({
  className,
  onNodeClick,
  selectedNodeId,
}: GlobalGraphViewProps) {
  const { t } = useTranslation()
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<ExtendedNode | null>(null)
  const graphRef = useRef<ForceGraphMethods<ExtendedNode, ExtendedLink> | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const pulseTimeRef = useRef(0)

  // Load global graph data
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    const loadGraph = async () => {
      try {
        const data = await getGlobalGraph()
        if (!cancelled) {
          setGraphData({
            nodes: data.nodes.map((node) => ({
              ...node,
            })),
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
          setError(err instanceof Error ? err.message : 'Failed to load global graph')
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
  }, [])

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

  // Pulse animation for core concepts (ref-driven to avoid React re-renders)
  useEffect(() => {
    let animationId: number
    const animate = () => {
      pulseTimeRef.current += 0.016
      ;(graphRef.current as unknown as { refresh?: () => void })?.refresh?.()
      animationId = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animationId)
  }, [])

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
    setHoveredNode(node as ExtendedNode | null)
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab'
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
      const fontSize = Math.max(12 / globalScale, 4)
      const baseNodeSize = 6
      const sourceCount = extNode.source_chunk_ids.length
      // Core concepts are larger (1.5x size multiplier)
      const regularNodeSize = Math.min(baseNodeSize + sourceCount * 0.5, 14)
      const nodeSize = extNode.is_core ? regularNodeSize * 1.5 : regularNodeSize

      const isSelected = extNode.id === selectedNodeId
      const isHovered = extNode.id === hoveredNode?.id

      // Get planet color
      let planetColor = DEFAULT_PLANET_COLOR
      if (extNode.is_core) {
        planetColor = CORE_COLOR
      } else if (extNode.category && PLANET_COLORS[extNode.category]) {
        planetColor = PLANET_COLORS[extNode.category]
      }

      // Pulse animation for core concepts
      const pulseScale = extNode.is_core ? 1 + Math.sin(pulseTimeRef.current * 2) * 0.08 : 1
      const finalSize = (isHovered ? nodeSize * 1.2 : nodeSize) * pulseScale

      // Draw planetary glow for core concepts
      if (extNode.is_core) {
        const glowIntensity = 0.3 + Math.sin(pulseTimeRef.current * 2) * 0.2
        const glowRadius = finalSize * (2.5 + Math.sin(pulseTimeRef.current * 1.5) * 0.5)
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, finalSize * 0.8,
          node.x, node.y, glowRadius
        )
        glowGradient.addColorStop(0, `rgba(0, 122, 255, ${glowIntensity})`)
        glowGradient.addColorStop(1, 'rgba(0, 122, 255, 0)')
        ctx.fillStyle = glowGradient
        ctx.beginPath()
        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI)
        ctx.fill()
      }

      // Draw hover glow
      if (isHovered) {
        const hoverGlowGradient = ctx.createRadialGradient(
          node.x, node.y, finalSize * 0.5,
          node.x, node.y, finalSize * 2
        )
        hoverGlowGradient.addColorStop(0, planetColor.atmosphere)
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
        ctx.beginPath()
        ctx.arc(node.x, node.y, finalSize + 2 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = extNode.is_core ? planetColor.glow : 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = extNode.is_core ? 2 / globalScale : 1.5 / globalScale
        ctx.stroke()
      }

      // Draw specular highlight
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

      // Draw source count badge
      if (sourceCount > 1 && globalScale >= 0.4) {
        const badgeRadius = Math.max(6 / globalScale, 3)
        const badgeX = node.x! + finalSize * 0.7
        const badgeY = node.y! - finalSize * 0.7

        // Badge glow
        const badgeGlow = ctx.createRadialGradient(badgeX, badgeY, 0, badgeX, badgeY, badgeRadius * 2)
        badgeGlow.addColorStop(0, 'rgba(255, 149, 0, 0.6)')
        badgeGlow.addColorStop(1, 'transparent')
        ctx.fillStyle = badgeGlow
        ctx.beginPath()
        ctx.arc(badgeX, badgeY, badgeRadius * 2, 0, 2 * Math.PI)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI)
        ctx.fillStyle = '#FF9500'
        ctx.fill()

        if (globalScale >= 0.6) {
          ctx.font = `bold ${Math.max(8 / globalScale, 4)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#ffffff'
          ctx.fillText(String(Math.min(sourceCount, 99)), badgeX, badgeY)
        }
      }

      // Draw label
      if (globalScale >= 0.5) {
        ctx.font = extNode.is_core ? `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` : `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'

        // Label background
        const textMetrics = ctx.measureText(label)
        const padding = 3 / globalScale
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.beginPath()
        ctx.roundRect(
          node.x! - textMetrics.width / 2 - padding,
          node.y! + finalSize + 2 / globalScale,
          textMetrics.width + padding * 2,
          fontSize + padding * 2,
          3 / globalScale
        )
        ctx.fill()

        // Label text
        ctx.fillStyle = extNode.is_core ? '#007AFF' : '#0F172A'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
        ctx.shadowBlur = 3
        ctx.fillText(label, node.x!, node.y! + finalSize + 2 / globalScale + padding)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }
    },
    [selectedNodeId, hoveredNode]
  )

  const linkCanvasObject = useCallback(
    (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as NodeObject
      const target = link.target as NodeObject

      if (!source.x || !source.y || !target.x || !target.y) return

      const sourceNode = source as ExtendedNode
      const targetNode = target as ExtendedNode

      const isHighlighted =
        selectedNodeId === sourceNode.id ||
        selectedNodeId === targetNode.id ||
        hoveredNode?.id === sourceNode.id ||
        hoveredNode?.id === targetNode.id

      // Draw cosmic connection
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      
      if (isHighlighted) {
        const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y)
        gradient.addColorStop(0, 'rgba(0, 122, 255, 0.6)')
        gradient.addColorStop(1, 'rgba(88, 86, 214, 0.6)')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.5 / globalScale
      } else {
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)'
        ctx.lineWidth = 0.5 / globalScale
        ctx.setLineDash([3, 3])
      }
      ctx.stroke()
      ctx.setLineDash([])

      // Animated particles on highlighted links
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
    },
    [selectedNodeId, hoveredNode]
  )

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        <span className="ml-3 text-gray-500 font-sans">Loading global graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-red-500', className)}>
        <p>Failed to load global graph</p>
        <p className="text-sm text-red-500/70">{error}</p>
      </div>
    )
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-gray-500', className)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="h-16 w-16 opacity-40 text-blue-600">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        <p className="mt-4 text-gray-600 font-sans">No concepts in global graph</p>
        <p className="text-sm text-gray-400 mt-1">Extract concepts from books to build the knowledge map</p>
      </div>
    )
  }

  const coreConceptCount = graphData.nodes.filter((n) => n.is_core).length

  return (
    <div ref={containerRef} className={cn('relative h-full w-full', className)}>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData as { nodes: ExtendedNode[]; links: ExtendedLink[] }}
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
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Stats */}
      <div className="absolute bottom-3 left-3 text-xs text-gray-500 bg-white/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200 font-sans shadow-apple-sm">
        {graphData.nodes.length} nodes, {graphData.links.length} connections (global)
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-apple-md">
        <div className="text-xs font-sans font-medium text-blue-600 mb-2">{t('graph.legend')}</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-md" />
            <span className="text-xs text-gray-600 font-sans">
              Core ({coreConceptCount})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <span className="text-xs text-gray-500 font-sans">
              Regular ({graphData.nodes.length - coreConceptCount})
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
