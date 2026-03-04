import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Concept {
  id: number;
  name: string;
  definition: string;
  category: string;
  importance_score: number;
  theme_id: number | null;
}

interface ConceptDetail extends Concept {
  neighbors: Array<{
    id: number;
    name: string;
    relation_type: string;
    strength: number;
  }>;
  relations: Array<{
    id: number;
    source_concept_id: number;
    target_concept_id: number;
    relation_type: string;
    strength: number;
    evidence: string;
  }>;
}

export const ConceptsPage: React.FC = () => {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');

  const fetchConcepts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getConcepts({
        page: currentPage,
        page_size: 20,
        search: searchTerm || undefined,
      });
      setConcepts(response.concepts);
      setTotalPages(Math.ceil(response.total / response.page_size));
    } catch (err) {
      setError('Failed to load concepts');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchTerm]);

  const fetchConceptDetail = async (conceptId: number) => {
    setLoading(true);
    try {
      const detail = await api.getConcept(conceptId);
      setSelectedConcept(detail);
    } catch (err) {
      setError('Failed to load concept details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConcepts();
  }, [fetchConcepts]);

  const categories = [...new Set(concepts.map(c => c.category))];

  const filteredConcepts = categoryFilter
    ? concepts.filter(c => c.category === categoryFilter)
    : concepts;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>📚 概念浏览</h1>
        <p>探索知识图谱中的所有核心概念及其关系</p>
      </div>

      {error && (
        <div className="error-message">
          <strong>错误:</strong> {error}
        </div>
      )}

      {!selectedConcept ? (
        <>
          {/* Search and Filter */}
          <div className="card">
            <div className="search-bar">
              <input
                type="text"
                className="form-input search-input"
                placeholder="搜索概念..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="form-select"
                style={{ width: '200px' }}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">所有分类</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={() => setCurrentPage(1)}>
                🔍 搜索
              </button>
            </div>
          </div>

          {/* Concepts Grid */}
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
              加载中...
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '1rem'
              }}>
                {filteredConcepts.map((concept) => (
                  <div
                    key={concept.id}
                    className="card"
                    style={{
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s',
                    }}
                    onClick={() => fetchConceptDetail(concept.id)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.1rem' }}>
                        {concept.name}
                      </h3>
                      <span style={{
                        background: '#e0e7ff',
                        color: '#4338ca',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 500
                      }}>
                        {concept.category}
                      </span>
                    </div>
                    <p style={{
                      color: '#64748b',
                      fontSize: '0.875rem',
                      marginTop: '0.75rem',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}>
                      {concept.definition}
                    </p>
                    <div style={{
                      marginTop: '1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        ID: {concept.id}
                      </span>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        color: '#6366f1'
                      }}>
                        <span>⭐</span>
                        <span>{(concept.importance_score * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  marginTop: '2rem'
                }}>
                  <button
                    className="btn btn-secondary"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    ← 上一页
                  </button>
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 1rem',
                    color: '#64748b'
                  }}>
                    第 {currentPage} 页，共 {totalPages} 页
                  </span>
                  <button
                    className="btn btn-secondary"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  >
                    下一页 →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        /* Concept Detail View */
        <div className="card">
          <button
            className="btn btn-secondary"
            onClick={() => setSelectedConcept(null)}
            style={{ marginBottom: '1.5rem' }}
          >
            ← 返回列表
          </button>

          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ margin: 0, color: '#1e293b' }}>{selectedConcept.name}</h2>
              <span style={{
                background: '#e0e7ff',
                color: '#4338ca',
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: 500
              }}>
                {selectedConcept.category}
              </span>
            </div>
            <p style={{
              color: '#374151',
              fontSize: '1rem',
              lineHeight: 1.7,
              marginTop: '1rem'
            }}>
              {selectedConcept.definition}
            </p>
          </div>

          {/* Related Concepts */}
          {selectedConcept.neighbors.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{ color: '#1e293b', marginBottom: '1rem' }}>🔗 相关概念</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '1rem'
              }}>
                {selectedConcept.neighbors.map((neighbor) => (
                  <div
                    key={neighbor.id}
                    style={{
                      padding: '1rem',
                      background: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontWeight: 500, color: '#1e293b' }}>
                        {neighbor.name}
                      </span>
                      <span style={{
                        fontSize: '0.75rem',
                        color: '#6366f1',
                        background: '#e0e7ff',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px'
                      }}>
                        {neighbor.relation_type}
                      </span>
                    </div>
                    <div style={{
                      marginTop: '0.5rem',
                      fontSize: '0.75rem',
                      color: '#94a3b8'
                    }}>
                      关联强度: {(neighbor.strength * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relations Table */}
          {selectedConcept.relations.length > 0 && (
            <div>
              <h3 style={{ color: '#1e293b', marginBottom: '1rem' }}>📋 关系详情</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem'
                }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>类型</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>目标</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', borderBottom: '2px solid #e2e8f0' }}>强度</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedConcept.relations.map((relation) => (
                      <tr key={relation.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem' }}>
                          <span style={{
                            background: '#dbeafe',
                            color: '#1d4ed8',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem'
                          }}>
                            {relation.relation_type}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem', color: '#1e293b' }}>
                          {relation.target_concept_id === selectedConcept.id
                            ? `← ${relation.source_concept_id}`
                            : `→ ${relation.target_concept_id}`}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                          <div style={{
                            width: '60px',
                            height: '6px',
                            background: '#e2e8f0',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            margin: '0 auto'
                          }}>
                            <div style={{
                              width: `${relation.strength * 100}%`,
                              height: '100%',
                              background: '#6366f1',
                              borderRadius: '3px'
                            }} />
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem', color: '#64748b', maxWidth: '300px' }}>
                          <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {relation.evidence}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
