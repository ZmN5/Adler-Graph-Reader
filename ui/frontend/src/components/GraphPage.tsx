import { useEffect, useState, useCallback } from 'react';
import { SigmaContainer, useSigma, useLoadGraph, useRegisterEvents } from '@react-sigma/core';
import { useWorkerLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2';
import Graph from 'graphology';
import { graphApi, api } from '../services/api';
import '@react-sigma/core/lib/react-sigma.min.css';

interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
}

interface GraphLink {
  source: string;
  target: string;
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

// Sigma Graph Controller Component
function GraphController({
  graphData,
  onNodeClick,
  highlightedNode,
}: {
  graphData: GraphData;
  onNodeClick: (node: GraphNode | null) => void;
  highlightedNode: string | null;
}) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const { start, stop } = useWorkerLayoutForceAtlas2({
    settings: {
      gravity: 0.05,
      scalingRatio: 10,
      slowDown: 2,
    },
  });

  // Register events
  const registerEvents = useRegisterEvents();

  useEffect(() => {
    registerEvents({
      clickNode: (e: { node: string }) => {
        const nodeId = e.node;
        const nodeData = graphData.nodes.find((n) => n.id === nodeId);
        if (nodeData) {
          onNodeClick(nodeData);
        }
      },
      clickStage: () => {
        onNodeClick(null);
      },
    });
  }, [registerEvents, graphData, onNodeClick]);

  // Load graph data
  useEffect(() => {
    const graph = new Graph();

    // Add nodes
    graphData.nodes.forEach((node) => {
      graph.addNode(node.id, {
        label: node.name,
        size: 8,
        color: getNodeColor(node.type),
        type: node.type,
        description: node.description,
        confidence: node.confidence,
        x: Math.random() * 100,
        y: Math.random() * 100,
      });
    });

    // Add edges
    graphData.links.forEach((link, index) => {
      if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
        graph.addEdge(link.source, link.target, {
          id: `edge-${index}`,
          label: link.type,
          size: 1,
          color: '#999',
          type: link.type,
          confidence: link.confidence,
        });
      }
    });

    loadGraph(graph);
    start();

    return () => {
      stop();
    };
  }, [graphData, loadGraph, start, stop]);

  // Handle node highlighting
  useEffect(() => {
    const graph = sigma.getGraph();

    if (highlightedNode) {
      // Get connected nodes
      const connectedNodes = new Set<string>([highlightedNode]);
      graph.forEachEdge((_, __, source, target) => {
        if (source === highlightedNode) connectedNodes.add(target);
        if (target === highlightedNode) connectedNodes.add(source);
      });

      // Update node colors
      graph.forEachNode((node, attributes) => {
        if (connectedNodes.has(node)) {
          graph.setNodeAttribute(node, 'color', getNodeColor(attributes.type as string));
        } else {
          graph.setNodeAttribute(node, 'color', '#e5e7eb');
        }
      });

      // Update edge colors
      graph.forEachEdge((edge, _, source, target) => {
        if (source === highlightedNode || target === highlightedNode) {
          graph.setEdgeAttribute(edge, 'color', '#999');
        } else {
          graph.setEdgeAttribute(edge, 'color', '#e5e7eb');
        }
      });
    } else {
      // Reset colors
      graph.forEachNode((node, attributes) => {
        graph.setNodeAttribute(node, 'color', getNodeColor(attributes.type as string));
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, 'color', '#999');
      });
    }
  }, [highlightedNode, sigma]);

  return null;
}

export default function GraphPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
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

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!graphData || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = graphData.nodes.filter((n) =>
      n.name.toLowerCase().includes(query.toLowerCase())
    );
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
              fontSize: '14px',
            }}
          />
          {searchResults.length > 0 && (
            <div
              style={{
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
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              }}
            >
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
                    borderBottom: '1px solid #f3f4f6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{node.name}</span>
                  <span
                    style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      marginLeft: '8px',
                    }}
                  >
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
              fontSize: '14px',
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
      <div style={{ flex: 1, position: 'relative', background: '#f9fafb' }}>
        {graphData && (
          <SigmaContainer
            style={{ width: '100%', height: '100%' }}
            settings={{
              nodeProgramClasses: {},
              edgeProgramClasses: {},
              labelFont: 'Arial',
              labelSize: 12,
              labelColor: { color: '#374151' },
              renderLabels: true,
              renderEdgeLabels: false,
            }}
          >
            <GraphController
              graphData={graphData}
              onNodeClick={handleNodeClick}
              highlightedNode={selectedNode?.id || null}
            />
          </SigmaContainer>
        )}

        {/* Legend */}
        {showLegend && (
          <div
            style={{
              position: 'absolute',
              right: '16px',
              top: '16px',
              background: 'white',
              padding: '16px',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '14px' }}>图例</span>
              <button
                onClick={() => setShowLegend(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '18px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(colorMap).map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: color,
                    }}
                  ></span>
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
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            显示图例
          </button>
        )}

        {/* Selected Node Panel */}
        {selectedNode && (
          <div
            style={{
              position: 'absolute',
              right: '16px',
              bottom: '16px',
              width: '280px',
              background: 'white',
              borderRadius: '8px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb',
              padding: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
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
                  lineHeight: 1,
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
