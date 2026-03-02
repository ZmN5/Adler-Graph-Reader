import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import axios from 'axios'
import { Card, Spin } from 'antd'

const API_BASE = 'http://localhost:8000'

interface Node {
  id: number
  name: string
  definition: string
  importance: number
  category: string
}

interface Link {
  source: number | Node
  target: number | Node
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

function GraphCanvas({ documentId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  useEffect(() => {
    if (!documentId || !svgRef.current) return

    setLoading(true)
    
    axios.get<GraphData>(`${API_BASE}/api/graph/${documentId}`)
      .then(res => {
        const data = res.data
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
    const height = 600

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)

    const g = svg.append('g')

    // Create force simulation
    const simulation = d3.forceSimulation<Node>(data.nodes)
      .force('link', d3.forceLink<Node, Link>(data.links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30))

    // Create links
    const link = g.append('g')
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => Math.sqrt(d.strength) * 2)

    // Create nodes
    const node = g.append('g')
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

    // Add circles to nodes
    node.append('circle')
      .attr('r', d => 10 + d.importance * 15)
      .attr('fill', d => {
        const colors: Record<string, string> = {
          concept: '#1890ff',
          principle: '#52c41a',
          method: '#faad14',
          tool: '#f5222d',
        }
        return colors[d.category] || '#1890ff'
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)

    // Add labels to nodes
    node.append('text')
      .text(d => d.name.length > 15 ? d.name.slice(0, 15) + '...' : d.name)
      .attr('x', 15)
      .attr('y', 5)
      .attr('font-size', '12px')
      .attr('fill', '#333')

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
  }

  return (
    <div style={{ position: 'relative' }}>
      <Spin spinning={loading} tip="加载知识图谱...">
        <svg
          ref={svgRef}
          width="100%"
          height={600}
          style={{ background: '#fafafa', borderRadius: 8 }}
        />
      </Spin>
      
      {selectedNode && (
        <Card
          title={selectedNode.name}
          size="small"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            width: 300,
            zIndex: 10,
          }}
          onClick={() => setSelectedNode(null)}
        >
          <p><strong>定义:</strong> {selectedNode.definition}</p>
          <p><strong>重要性:</strong> {(selectedNode.importance * 100).toFixed(0)}%</p>
          <p><strong>类别:</strong> {selectedNode.category}</p>
        </Card>
      )}
    </div>
  )
}

export default GraphCanvas
