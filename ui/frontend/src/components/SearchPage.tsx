import { useState, useEffect } from 'react';
import { api, documentsApi } from '../services/api';
import { useDebounce } from '../hooks';
import { SearchResultItem } from '../types';

interface DocumentInfo {
  document_id: string;
  chunk_count: number;
  theme_count: number;
  concept_count: number;
  relation_count: number;
}

export const SearchPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchOptions, setSearchOptions] = useState({
    top_k: 10,
    use_reranker: true,
  });

  // Load available documents on mount
  useEffect(() => {
    const loadDocuments = async () => {
      try {
        const response = await documentsApi.getAll();
        let docs: DocumentInfo[];
        if (Array.isArray(response)) {
          docs = response as unknown as DocumentInfo[];
        } else {
          docs = ((response as any).documents || []) as DocumentInfo[];
        }
        setDocuments(docs);
        // Set default document if available
        if (docs.length > 0 && !documentId) {
          setDocumentId(docs[0].document_id);
        }
      } catch (err) {
        console.error('Failed to load documents:', err);
      }
    };
    loadDocuments();
  }, []);

  // Debounce the search query to avoid too many API calls
  const debouncedQuery = useDebounce(query, 300);

  // Auto-search when debounced query changes (if user has already searched once)
  useEffect(() => {
    if (hasSearched && debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    }
  }, [debouncedQuery, documentId, searchOptions.top_k, searchOptions.use_reranker]);

  const performSearch = async (searchQuery: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.search({
        query: searchQuery.trim(),
        document_id: documentId,
        top_k: searchOptions.top_k,
        use_reranker: searchOptions.use_reranker,
      });
      setResults(response.results || []);
    } catch (err) {
      setError('搜索失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setHasSearched(true);
    await performSearch(query);
  };

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} style={{
          background: '#fef08a',
          padding: '0 2px',
          borderRadius: '2px'
        }}>{part}</mark>
      ) : part
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🔍 智能搜索</h1>
        <p>全文检索 + 语义搜索，快速定位文档内容</p>
      </div>

      {/* Search Form */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <form onSubmit={handleSearch}>
          <div className="form-group">
            <label className="form-label">搜索查询</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, fontSize: '1rem' }}
                placeholder="输入关键词或问题..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !query.trim()}
                style={{ minWidth: '100px' }}
              >
                {loading ? '搜索中...' : '🔍 搜索'}
              </button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1rem'
          }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">文档</label>
              <select
                className="form-select"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                disabled={documents.length === 0}
              >
                {documents.length === 0 ? (
                  <option value="">加载中...</option>
                ) : (
                  documents.map((doc) => (
                    <option key={doc.document_id} value={doc.document_id}>
                      {doc.document_id}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">结果数量</label>
              <select
                className="form-select"
                value={searchOptions.top_k}
                onChange={(e) => setSearchOptions(prev => ({
                  ...prev,
                  top_k: parseInt(e.target.value)
                }))}
              >
                <option value={5}>5 条</option>
                <option value={10}>10 条</option>
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">选项</label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: 'pointer',
                padding: '0.5rem 0'
              }}>
                <input
                  type="checkbox"
                  checked={searchOptions.use_reranker}
                  onChange={(e) => setSearchOptions(prev => ({
                    ...prev,
                    use_reranker: e.target.checked
                  }))}
                />
                <span style={{ fontSize: '0.875rem', color: '#374151' }}>
                  使用重排序优化结果
                </span>
              </label>
            </div>
          </div>
        </form>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <strong>错误:</strong> {error}
        </div>
      )}

      {/* Search Results */}
      {hasSearched && !loading && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }}>
            <h2 style={{ margin: 0, color: '#1e293b', fontSize: '1.25rem' }}>
              搜索结果
              <span style={{
                marginLeft: '0.5rem',
                fontSize: '0.875rem',
                color: '#64748b',
                fontWeight: 'normal'
              }}>
                共 {results.length} 条
              </span>
            </h2>
          </div>

          {results.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
              <h3>未找到相关结果</h3>
              <p>尝试使用不同的关键词或调整搜索选项</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {results.map((result, index) => (
                <div
                  key={result.tree_id}
                  className="card"
                  style={{
                    marginBottom: 0,
                    borderLeft: '4px solid #6366f1',
                    transition: 'transform 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateX(4px)';
                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  {/* Result Header */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{
                        background: '#6366f1',
                        color: 'white',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.875rem',
                        fontWeight: 'bold'
                      }}>
                        {index + 1}
                      </span>
                      {result.page_number && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: '#64748b',
                          background: '#f1f5f9',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px'
                        }}>
                          第 {result.page_number} 页
                        </span>
                      )}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>相关度</span>
                      <div style={{
                        width: '80px',
                        height: '8px',
                        background: '#e2e8f0',
                        borderRadius: '4px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${result.score * 100}%`,
                          height: '100%',
                          background: result.score > 0.7 ? '#22c55e' : result.score > 0.4 ? '#f59e0b' : '#ef4444',
                          borderRadius: '4px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: result.score > 0.7 ? '#22c55e' : result.score > 0.4 ? '#f59e0b' : '#ef4444'
                      }}>
                        {(result.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div style={{
                    background: '#f8fafc',
                    padding: '1rem',
                    borderRadius: '8px',
                    lineHeight: 1.7,
                    color: '#374151'
                  }}>
                    {highlightText(result.content, query)}
                  </div>

                  {/* Context */}
                  {result.context.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <span style={{
                        fontSize: '0.75rem',
                        color: '#94a3b8',
                        fontWeight: 500
                      }}>
                        上下文:
                      </span>
                      <div style={{
                        marginTop: '0.5rem',
                        paddingLeft: '1rem',
                        borderLeft: '2px solid #e2e8f0'
                      }}>
                        {result.context.map((ctx, i) => (
                          <p
                            key={i}
                            style={{
                              margin: '0.25rem 0',
                              fontSize: '0.8125rem',
                              color: '#64748b',
                              lineHeight: 1.5
                            }}
                          >
                            {ctx.length > 150 ? ctx.substring(0, 150) + '...' : ctx}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Initial State */}
      {!hasSearched && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">💡</div>
          <h3>开始搜索</h3>
          <p>输入关键词，探索文档中的知识</p>
          <div style={{
            marginTop: '1.5rem',
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            {['语法规则', '概念定义', '例子分析', '章节总结'].map((suggestion) => (
              <button
                key={suggestion}
                className="btn btn-secondary"
                onClick={() => {
                  setQuery(suggestion);
                }}
                style={{ fontSize: '0.8125rem' }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
