import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { graphApi, api } from '../services/api';

interface GraphNode {
  id: string;
  name: string;
  type: string;
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
}

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

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<D3Node[]>([]);
  const [showLegend, setShowLegend] = useState(true);

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
      .attr('stroke-width', 2)
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
            d.fx = d.x ?? null;
            d.fy = d.y ?? null;
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
      .attr('r', 8)
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
    node.on('click', (event, d) => {
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

    return () => {
      simulation.stop();
    };
  }, [graphData]);

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!graphData || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = graphData.nodes
      .filter((n) => n.name.toLowerCase().includes(query.toLowerCase()))
      .map((n) => n as unknown as D3Node);
    setSearchResults(filtered);
  };

  // Handle export
  const handleExport = async (format: 'json' | 'graphml' | 'gexf' | 'dot') => {
    try {
      const blob = await api.exportGraph('', format);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `graph.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败，请稍后重试');
    }
  };

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
        
        {/* Search Box */}
        <div style={{ position: 'relative', width: '300px' }}>
          <input
            type="text"
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '14px'
            }}
          />
          {searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              marginTop: '4px',
              maxHeight: '200px',
              overflowY: 'auto',
              zIndex: 50,
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}>
              {searchResults.map((node) => (
                <div
                  key={node.id}
                  onClick={() => {
                    setSelectedNode(node);
                    setSearchQuery(node.name);
                    setSearchResults([]);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{node.name}</span>
                  <span style={{ 
                    fontSize: '12px', 
                    color: '#6b7280',
                    marginLeft: '8px'
                  }}>
                    ({node.type})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Export Button */}
        <div style={{ position: 'relative' }}>
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleExport(e.target.value as 'json' | 'graphml' | 'gexf' | 'dot');
                e.target.value = '';
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              background: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <option value="">📥 导出图谱</option>
            <option value="json">JSON</option>
            <option value="graphml">GraphML</option>
            <option value="gexf">GEXF</option>
            <option value="dot">DOT</option>
          </select>
        </div>
      </div>

      {/* Graph Container */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', background: '#f9fafb' }}>
        <svg ref={svgRef} style={{ width: '100%', height: '100%' }}></svg>

        {/* Legend */}
        {showLegend && (
          <div style={{
            position: 'absolute',
            right: '16px',
            top: '16px',
            background: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            border: '1px solid #e5e7eb'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>图例</span>
              <button
                onClick={() => setShowLegend(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '18px',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(colorMap).map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: color
                  }}></span>
                  <span style={{ fontSize: '13px', color: '#4b5563', textTransform: 'capitalize' }}>
                    {type === 'default' ? '其他' : type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show Legend Button (when hidden) */}
        {!showLegend && (
          <button
            onClick={() => setShowLegend(true)}
            style={{
              position: 'absolute',
              right: '16px',
              top: '16px',
              padding: '8px 16px',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}
          >
            显示图例
          </button>
        )}

        {/* Selected Node Panel */}
        {selectedNode && (
          <div style={{
            position: 'absolute',
            right: '16px',
            bottom: '16px',
            width: '280px',
            background: 'white',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            border: '1px solid #e5e7eb',
            padding: '16px'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <h3 style={{ 
                fontSize: '16px', 
                fontWeight: 600,
                color: '#111827'
              }}>
                {selectedNode.name}
              </h3>
              <button
                onClick={() => setSelectedNode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '20px',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              <p style={{ marginBottom: '4px' }}>
                <span style={{ color: '#9ca3af' }}>类型:</span> {selectedNode.type}
              </p>
              <p style={{ marginBottom: '4px' }}>
                <span style={{ color: '#9ca3af' }}>ID:</span> {selectedNode.id}
              </p>
              {selectedNode.confidence && (
                <p>
                  <span style={{ color: '#9ca3af' }}>置信度:</span>{' '}
                  {(selectedNode.confidence * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
