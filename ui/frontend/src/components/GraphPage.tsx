import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { graphApi, GraphData, GraphNode, GraphLink } from '../services/api';

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  type: string;
  confidence?: number;
}

const colorMap: Record<string, string> = {
  person: '#4f46e5',
  organization: '#10b981',
  location: '#f59e0b',
  concept: '#8b5cf6',
  event: '#ef4444',
  default: '#6b7280',
};

const getNodeColor = (type: string) => colorMap[type] || colorMap.default;

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; content: string }>({
    visible: false,
    x: 0,
    y: 0,
    content: '',
  });

  // Fetch graph data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await graphApi.getGraph();
        setGraphData(data);
      } catch (err) {
        setError('加载图谱数据失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Initialize D3 graph
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !graphData) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    // Clear previous SVG content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current).attr('width', width).attr('height', height);

    // Add zoom behavior
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Prepare nodes and links
    const nodes: D3Node[] = graphData.nodes.map((n) => ({ ...n }));
    const links: D3Link[] = graphData.links.map((l) => ({ ...l }));

    // Create simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links).id((d) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create links
    const link = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#999')
      .attr('stroke-width', (d) => Math.sqrt(d.confidence || 1) * 2)
      .attr('stroke-opacity', 0.6);

    // Create nodes
    const node = g.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, D3Node>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Add circles to nodes
    node.append('circle')
      .attr('r', (d) => 8 + (d.confidence || 0.5) * 12)
      .attr('fill', (d) => getNodeColor(d.type))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Add labels to nodes
    node.append('text')
      .text((d) => d.name)
      .attr('x', 15)
      .attr('y', 4)
      .attr('font-size', '12px')
      .attr('fill', '#374151')
      .style('pointer-events', 'none');

    // Node interactions
    node
      .on('mouseover', (event, d) => {
        setTooltip({
          visible: true,
          x: event.pageX + 10,
          y: event.pageY - 10,
          content: `<strong>${d.name}</strong><br/>类型: ${d.type}<br/>置信度: ${((d.confidence || 0) * 100).toFixed(1)}%`,
        });
      })
      .on('mousemove', (event) => {
        setTooltip((prev) => ({ ...prev, x: event.pageX + 10, y: event.pageY - 10 }));
      })
      .on('mouseout', () => setTooltip((prev) => ({ ...prev, visible: false })))
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        const connectedIds = new Set<string>([d.id]);
        links.forEach((l) => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          if (sourceId === d.id) connectedIds.add(targetId);
          if (targetId === d.id) connectedIds.add(sourceId);
        });
        node.style('opacity', (n) => (connectedIds.has(n.id) ? 1 : 0.2));
        link.style('opacity', (l) => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          return sourceId === d.id || targetId === d.id ? 1 : 0.1;
        });
      });

    // Click background to reset
    svg.on('click', () => {
      setSelectedNode(null);
      node.style('opacity', 1);
      link.style('opacity', 0.6);
    });

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (typeof d.source !== 'string' ? d.source.x || 0 : 0))
        .attr('y1', (d) => (typeof d.source !== 'string' ? d.source.y || 0 : 0))
        .attr('x2', (d) => (typeof d.target !== 'string' ? d.target.x || 0 : 0))
        .attr('y2', (d) => (typeof d.target !== 'string' ? d.target.y || 0 : 0));
      node.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => simulation.stop();
  }, [graphData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="spinner"></div>
        <span className="ml-3 text-gray-600">加载图谱中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">知识图谱</h1>
          <p className="text-sm text-gray-500 mt-1">
            节点: {graphData?.nodes.length || 0} | 关系: {graphData?.links.length || 0}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-sm">
            {Object.entries(colorMap).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></span>
                <span className="text-gray-600 capitalize">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Graph Container */}
      <div ref={containerRef} className="flex-1 relative bg-gray-50">
        <svg ref={svgRef} className="w-full h-full"></svg>

        {/* Tooltip */}
        {tooltip.visible && (
          <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y }} dangerouslySetInnerHTML={{ __html: tooltip.content }} />
        )}

        {/* Selected Node Panel */}
        {selectedNode && (
          <div className="absolute right-4 top-4 w-80 bg-white rounded-lg shadow-lg p-4" style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800">{selectedNode.name}</h3>
              <button
                onClick={() => {
                  setSelectedNode(null);
                  d3.select(svgRef.current).selectAll('.nodes g').style('opacity', 1);
                  d3.select(svgRef.current).selectAll('.links line').style('opacity', 0.6);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">类型:</span>
                <span className="px-2 py-1 rounded text-white text-xs" style={{ backgroundColor: getNodeColor(selectedNode.type) }}>
                  {selectedNode.type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">置信度:</span>
                <span>{((selectedNode.confidence || 0) * 100).toFixed(1)}%</span>
              </div>
              {selectedNode.description && (
                <div>
                  <span className="text-gray-500">描述:</span>
                  <p className="mt-1 text-gray-700">{selectedNode.description}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="absolute left-4 bottom-4 flex flex-col gap-2">
          <button
            onClick={() => {
              d3.select(svgRef.current).transition().duration(750).call(d3.zoom().transform, d3.zoomIdentity);
            }}
            className="btn btn-secondary shadow"
          >
            ⟲ 重置视图
          </button>
        </div>
      </div>
    </div>
  );
}
