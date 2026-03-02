import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import axios from 'axios'
import { Card, Spin, Tag, Empty } from 'antd'

const API_BASE = 'http://localhost:8000'

// Enhanced node interface with position
interface Node extends d3.SimulationNodeDatum {
  id: number
  name: string
  definition: string
  importance: number
  category: string
}

// Enhanced link interface with position
interface Link extends d3.SimulationLinkDatum<Node> {
  type: string
  strength: number
}

interface GraphData {
  nodes: Node[]
  links: Link[]
}

interface Props {
  documentId: string
}

// Color scheme for different relation types
const RELATION_COLORS: Record<string, string> = {
  broader_than: '#722ed1',
  narrower_than: '#13c2c2',
  part_of: '#eb2f96',
  implements: '#52c41a',
  uses: '#faad14',
  produces: '#fa541c',
  evaluates: '#2f54eb',
  improves: '#a0d911',
  related_to: '#999999',
  similar_to: '#f5222d',
  prerequisite_for: '#1890ff',
  causes: '#eb2f96',
  contradicts: '#f5222d',
  supports: '#52c41a',
}

// Color scheme for node categories
const CATEGORY_COLORS: Record<string, string> = {
  concept: '#1890ff',
  principle: '#722ed1',
  method: '#faad14',
  tool: '#f5222d',
  person: '#13c2c2',
  event: '#eb2f96',
}

function GraphCanvas({ documentId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  useEffect(() => {
    if (!documentId || !svgRef.current) return

    setLoading(true)
    
    axios.get<GraphData>(`${API_BASE}/api/graph/${documentId}`)
      .then(res => {
        const data = res.data
        if (data.nodes.length === 0) {
          setLoading(false)
          return
        }
        setGraphData(data)
        renderGraph(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch graph:', err)
        setLoading(false)
      })
  }, [documentId])

  const renderGraph = (data: GraphData) => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = 700

    // Create gradient definitions
    const defs = svg.append('defs')
    
    // Glow filter for nodes
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%')
    
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur')
    
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Arrow markers for different relation types
    Object.entries(RELATION_COLORS).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color)
    })

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        mainGroup.attr('transform', event.transform)
      })

    svg.call(zoom)

    const mainGroup = svg.append('g')

    // Add background grid
    const gridSize = 50
    for (let x = 0; x < width; x += gridSize) {
      mainGroup.append('line')
        .attr('x1', x).attr('y1', 0)
        .attr('x2', x).attr('y2', height)
        .attr('stroke', '#f0f0f0')
        .attr('stroke-width', 1)
    }
    for (let y = 0; y < height; y += gridSize) {
      mainGroup.append('line')
        .attr('x1', 0).attr('y1', y)
        .attr('x2', width).attr('y2', y)
        .attr('stroke', '#f0f0f0')
        .attr('stroke-width', 1)
    }

    // Create force simulation with better parameters
    const simulation = d3.forceSimulation<Node>(data.nodes)
      .force('link', d3.forceLink<Node, Link>(data.links)
        .id(d => d.id)
        .distance(120)
        .strength(d => d.strength * 0.5))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))

    // Create links group (behind nodes)
    const linksGroup = mainGroup.append('g').attr('class', 'links')
    
    const link = linksGroup
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke', d => RELATION_COLORS[d.type] || '#999')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', d => Math.max(1, Math.sqrt(d.strength) * 2))
      .attr('marker-end', d => `url(#arrow-${d.type})`)

    // Add hover effect for links
    link.on('mouseover', function(event, d) {
      d3.select(this)
        .attr('stroke-opacity', 0.8)
        .attr('stroke-width', Math.max(2, Math.sqrt(d.strength) * 4))
    }).on('mouseout', function(event, d) {
      d3.select(this)
        .attr('stroke-opacity', 0.4)
        .attr('stroke-width', Math.max(1, Math.sqrt(d.strength) * 2))
    })

    // Create nodes group
    const nodesGroup = mainGroup.append('g').attr('class', 'nodes')

    const node = nodesGroup
      .selectAll('g')
      .data(data.nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, Node>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null
          d.fy = null
        })
      )

    // Add glow effect circle (hidden by default)
    node.append('circle')
      .attr('r', d => 15 + d.importance * 20)
      .attr('fill', d => CATEGORY_COLORS[d.category] || '#1890ff')
      .attr('opacity', 0)
      .attr('class', 'glow')

    // Add main circles to nodes
    node.append('circle')
      .attr('r', d => 12 + d.importance * 18)
      .attr('fill', d => CATEGORY_COLORS[d.category] || '#1890ff')
      .attr('stroke', '#fff')
      .attr('stroke-width', 3)
      .attr('class', 'main-circle')

    // Add gradient fill
    const gradient = defs.append('radialGradient')
      .attr('id', 'nodeGradient')
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#fff')
      .attr('stop-opacity', 0.3)
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#fff')
      .attr('stop-opacity', 0)

    node.append('circle')
      .attr('r', d => 12 + d.importance * 18)
      .attr('fill', 'url(#nodeGradient)')

    // Add labels to nodes
    node.append('text')
      .text(d => d.name.length > 18 ? d.name.slice(0, 18) + '...' : d.name)
      .attr('x', 20)
      .attr('y', 5)
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .attr('fill', '#333')
      .attr('pointer-events', 'none')

    // Hover handlers
    node.on('mouseover', function(event, d) {
      // Expand the node
      d3.select(this).select('.main-circle')
        .transition()
        .duration(200)
        .attr('r', (d.importance * 18 + 12) * 1.2)
        .attr('stroke-width', 4)
      
      // Show glow
      d3.select(this).select('.glow')
        .transition()
        .duration(200)
        .attr('opacity', 0.3)
      
      setHoveredNode(d)
      
      // Highlight connected links
      link.attr('stroke-opacity', l => {
        const source = typeof l.source === 'object' ? (l.source as Node).id : l.source
        const target = typeof l.target === 'object' ? (l.target as Node).id : l.target
        return source === d.id || target === d.id ? 0.8 : 0.1
      })
    }).on('mouseout', function(event, d) {
      // Restore the node
      d3.select(this).select('.main-circle')
        .transition()
        .duration(200)
        .attr('r', d.importance * 18 + 12)
        .attr('stroke-width', 3)
      
      // Hide glow
      d3.select(this).select('.glow')
        .transition()
        .duration(200)
        .attr('opacity', 0)
      
      setHoveredNode(null)
      
      // Restore link opacity
      link.attr('stroke-opacity', 0.4)
    })

    // Click handler
    node.on('click', (event, d) => {
      event.stopPropagation()
      setSelectedNode(d)
    })

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x!)
        .attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!)
        .attr('y2', d => (d.target as Node).y!)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    // Add legend
    const legend = mainGroup.append('g')
      .attr('transform', `translate(${width - 150}, 20)`)

    legend.append('text')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('关系类型')

    const legendItems = [
      { type: 'prerequisite_for', label: '前置依赖' },
      { type: 'related_to', label: '相关' },
      { type: 'similar_to', label: '相似' },
      { type: 'broader_than', label: '上位概念' },
      { type: 'uses', label: '使用' },
      { type: 'causes', label: '导致' },
    ]

    legendItems.forEach((item, i) => {
      const g = legend.append('g')
        .attr('transform', `translate(0, ${20 + i * 20})`)
      
      g.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 20).attr('y2', 0)
        .attr('stroke', RELATION_COLORS[item.type] || '#999')
        .attr('stroke-width', 2)
        .attr('marker-end', `url(#arrow-${item.type})`)
      
      g.append('text')
        .attr('x', 25)
        .attr('y', 4)
        .attr('font-size', '10px')
        .text(item.label)
    })

    // Add category legend
    const categoryLegend = mainGroup.append('g')
      .attr('transform', `translate(20, ${height - 100})`)

    categoryLegend.append('text')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('概念类别')

    const categoryItems = [
      { category: 'concept', label: '概念' },
      { category: 'method', label: '方法' },
      { category: 'principle', label: '原理' },
      { category: 'tool', label: '工具' },
    ]

    categoryItems.forEach((item, i) => {
      const g = categoryLegend.append('g')
        .attr('transform', `translate(${i * 80}, 20)`)
      
      g.append('circle')
        .attr('r', 8)
        .attr('fill', CATEGORY_COLORS[item.category])
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
      
      g.append('text')
        .attr('x', 15)
        .attr('y', 4)
        .attr('font-size', '10px')
        .text(item.label)
    })
  }

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (graphData) {
        renderGraph(graphData)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [graphData])

  return (
    <div style={{ position: 'relative' }}>
      <Spin spinning={loading} tip="加载知识图谱...">
        <svg
          ref={svgRef}
          width="100%"
          height={700}
          style={{ background: '#fafafa', borderRadius: 8 }}
        />
      </Spin>
      
      {selectedNode && (
        <Card
          title={
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ 
                display: 'inline-block',
                width: 12, 
                height: 12, 
                borderRadius: '50%', 
                background: CATEGORY_COLORS[selectedNode.category] || '#1890ff' 
              }} />
              {selectedNode.name}
            </span>
          }
          size="small"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            width: 320,
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
          hoverable
          onClick={() => setSelectedNode(null)}
        >
          <div style={{ marginBottom: 8 }}>
            <strong>定义:</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
              {selectedNode.definition}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <strong>重要性:</strong>
              <Tag color="blue">{(selectedNode.importance * 100).toFixed(0)}%</Tag>
            </div>
            <div>
              <strong>类别:</strong>
              <Tag color={CATEGORY_COLORS[selectedNode.category] || 'blue'}>
                {selectedNode.category}
              </Tag>
            </div>
          </div>
        </Card>
      )}

      {hoveredNode && !selectedNode && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            background: 'rgba(255,255,255,0.95)',
            padding: '8px 12px',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: 12,
          }}
        >
          <strong>{hoveredNode.name}</strong>
          <span style={{ color: '#666', marginLeft: 8 }}>
            重要性: {(hoveredNode.importance * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

export default GraphCanvas