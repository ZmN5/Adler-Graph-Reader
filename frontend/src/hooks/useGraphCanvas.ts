import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getBookGraph } from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
import type { NodeObject, LinkObject } from 'react-force-graph-2d'

const INITIAL_NODE_LIMIT = 50
const NODE_INCREMENT = 50

interface GraphData {
  nodes: {
    id: string
    name: string
    description: string
    examples: string[]
    source_chunk_ids: string[]
    is_core: boolean
    category?: string
  }[]
  links: {
    id: string
    source: string
    target: string
    relation_type: string
  }[]
}

export interface ExtendedNode extends NodeObject {
  id: string
  name: string
  description: string
  examples: string[]
  source_chunk_ids: string[]
  is_core: boolean
  category?: string
  pulsePhase?: number
}

export interface ExtendedLink extends LinkObject {
  id: string
  source: string | ExtendedNode
  target: string | ExtendedNode
  relation_type: string
}

export function useGraphCanvas(bookId: string) {
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
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const pulseTimeRef = useRef(0)
  const pulseTimeObj = useRef({ current: 0 })

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

  const handleNodeHover = useCallback((node: NodeObject | null) => {
    const extNode = node as ExtendedNode | null
    setHoveredNode(extNode)
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

  return {
    t,
    graphData,
    isLoading,
    error,
    hoveredNode,
    visibleNodeCount,
    selectedCategories,
    searchQuery,
    showOnlyCore,
    tooltip,
    dimensions,
    setDimensions,
    pulseTimeRef,
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
    setTooltip,
  }
}
