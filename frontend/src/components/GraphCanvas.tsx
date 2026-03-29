import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getBookGraph, GraphNode } from '@/lib/api-client'
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import { Search, Star } from 'lucide-react'

const INITIAL_NODE_LIMIT = 50
const NODE_INCREMENT = 50

// Category colors mapping
const CATEGORY_COLORS: Record<string, string> = {
  Philosophy: '#3b82f6', // blue-500
  Science: '#10b981', // emerald-500
  History: '#f59e0b', // amber-500
  Art: '#ec4899', // pink-500
  Technology: '#06b6d4', // cyan-500
  Politics: '#ef4444', // red-500
  Economics: '#84cc16', // lime-500
  Psychology: '#8b5cf6', // violet-500
  Other: '#64748b', // slate-500
}

const DEFAULT_CATEGORY_COLOR = '#64748b' // slate-500

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
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<ExtendedNode | null>(null)
  const [visibleNodeCount, setVisibleNodeCount] = useState(INITIAL_NODE_LIMIT)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showOnlyCore, setShowOnlyCore] = useState(false)
  const graphRef = useRef<ForceGraphMethods<ExtendedNode, ExtendedLink> | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

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
      // Use timeout to allow graph to render first
      setTimeout(() => {
        graphRef.current?.centerAt(0, 0, 500)
      }, 100)
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
    setHoveredNode(node as ExtendedNode | null)
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab'
    }
  }, [])

  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const extNode = node as ExtendedNode
      const label = extNode.name
      const fontSize = Math.max(12 / globalScale, 4)
      // Core concepts are larger (1.5x size multiplier)
      const baseSize = Math.min(8 + extNode.source_chunk_ids.length, 16)
      const nodeSize = extNode.is_core ? baseSize * 1.5 : baseSize

      // Draw node circle
      const isSelected = extNode.id === selectedNodeId
      const isHovered = extNode.id === hoveredNode?.id

      ctx.beginPath()
      ctx.arc(node.x!, node.y!, nodeSize, 0, 2 * Math.PI)

      // Fill color based on state, core status, and category
      if (isSelected) {
        ctx.fillStyle = '#3b82f6' // primary
      } else if (isHovered) {
        ctx.fillStyle = '#60a5fa' // lighter primary
      } else if (extNode.category) {
        // Use category color if available
        ctx.fillStyle = CATEGORY_COLORS[extNode.category] || DEFAULT_CATEGORY_COLOR
      } else if (extNode.is_core) {
        ctx.fillStyle = '#8b5cf6' // purple-500 for core concepts without category
      } else {
        ctx.fillStyle = '#94a3b8' // muted-foreground for regular concepts
      }
      ctx.fill()

      // Border for selected/hovered/core concepts
      if (isSelected || isHovered || extNode.is_core) {
        ctx.strokeStyle = isSelected ? '#2563eb' : isHovered ? '#93c5fd' : '#7c3aed'
        ctx.lineWidth = extNode.is_core ? 3 / globalScale : 2 / globalScale
        ctx.stroke()
      }

      // Draw label with different style for core concepts
      if (globalScale >= 0.5) {
        ctx.font = extNode.is_core ? `bold ${fontSize}px sans-serif` : `${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = '#1e293b' // foreground
        ctx.fillText(label, node.x!, node.y! + nodeSize + 2 / globalScale)
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

      // Draw edge line
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.strokeStyle = '#cbd5e1' // border color
      ctx.lineWidth = 1 / globalScale
      ctx.stroke()

      // Draw relation type label at midpoint
      if (globalScale >= 0.6 && extLink.relation_type) {
        const midX = (source.x + target.x) / 2
        const midY = (source.y + target.y) / 2
        const fontSize = Math.max(8 / globalScale, 3)

        ctx.font = `${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#64748b' // muted-foreground
        ctx.fillText(extLink.relation_type, midX, midY)
      }
    },
    []
  )

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="ml-3 text-muted-foreground">Loading graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-destructive', className)}>
        <p>Failed to load graph</p>
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-muted-foreground', className)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-12 w-12 opacity-50">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        <p className="mt-4">No concepts extracted yet</p>
        <p className="text-sm">Extract concepts from your book to see the graph</p>
      </div>
    )
  }

  const coreConceptCount = visibleNodes.filter((n) => n.is_core).length
  const regularConceptCount = visibleNodes.length - coreConceptCount

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
        backgroundColor="#fafafa"
        linkDirectionalArrowLength={0}
        cooldownTicks={50}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.4}
      />
      <div className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded flex flex-col gap-1">
        <span>{visibleNodes.length} / {graphData.nodes.length} nodes visible</span>
        <span>{visibleLinks.length} edges visible</span>
        {hasMoreNodes && (
          <button
            onClick={handleLoadMore}
            className="mt-1 px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 transition-colors"
          >
            Load More (+{Math.min(NODE_INCREMENT, graphData.nodes.length - visibleNodeCount)})
          </button>
        )}
      </div>
      {/* Legend */}
      <div className="absolute top-3 right-3 bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 shadow-sm max-w-[180px]">
        <div className="text-xs font-medium text-foreground mb-1.5">Legend</div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-violet-500 border-2 border-violet-600" />
            <span className="text-xs text-muted-foreground">
              Core Concept ({coreConceptCount})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            <span className="text-xs text-muted-foreground">
              Regular Concept ({regularConceptCount})
            </span>
          </div>
        </div>
        {/* Category filter */}
        {allCategories.length > 0 && (
          <div className="mt-3 pt-2 border-t">
            <div className="text-xs font-medium text-foreground mb-1.5">Filter by Category</div>
            <div className="flex flex-col gap-1">
              {allCategories.map((category) => (
                <button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    'flex items-center gap-2 text-xs rounded px-1.5 py-1 transition-colors',
                    selectedCategories.has(category)
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted text-muted-foreground'
                  )}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR }}
                  />
                  <span className="truncate">{category}</span>
                </button>
              ))}
            </div>
            {selectedCategories.size > 0 && (
              <button
                onClick={clearCategoryFilter}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
        {/* Core concepts filter */}
        <div className="mt-3 pt-2 border-t">
          <button
            onClick={() => setShowOnlyCore(!showOnlyCore)}
            className={cn(
              'flex items-center gap-2 w-full text-xs rounded px-2 py-1.5 transition-colors',
              showOnlyCore
                ? 'bg-violet-500/10 text-violet-600'
                : 'hover:bg-muted text-muted-foreground'
            )}
          >
            <Star className="h-3 w-3" />
            <span>{showOnlyCore ? 'Showing Core Only' : 'Show Core Only'}</span>
          </button>
        </div>
        {/* Search filter */}
        <div className="mt-3 pt-2 border-t">
          <div className="text-xs font-medium text-foreground mb-1.5">Search Nodes</div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-full pl-7 pr-2 py-1.5 text-xs rounded border bg-background',
                'focus:outline-none focus:ring-1 focus:ring-primary'
              )}
            />
          </div>
          {(searchQuery || showOnlyCore) && (
            <button
              onClick={() => {
                setSearchQuery('')
                setShowOnlyCore(false)
              }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        {visibleNodes.length < graphData.nodes.length && (
          <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
            Showing {visibleNodes.length} of {graphData.nodes.length} nodes
          </div>
        )}
      </div>
    </div>
  )
}