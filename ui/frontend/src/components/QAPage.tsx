import { useState, useRef, useEffect } from 'react';
import { api, documentsApi } from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  confidence?: number;
  citedConcepts?: number[];
}

interface DocumentInfo {
  document_id: string;
  chunk_count: number;
  theme_count: number;
  concept_count: number;
  relation_count: number;
}

export const QAPage: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const response = await api.query({
        question: userMessage.content,
        document_id: documentId,
        session_id: sessionId || undefined,
      });

      // Save session ID for context continuity
      if (response.session_id) {
        setSessionId(response.session_id);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        confidence: response.confidence,
        citedConcepts: response.cited_concept_ids,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError('获取回答失败，请稍后重试');
      // Remove the user message on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSessionId(null);
    setError(null);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const suggestedQuestions = [
    '这本书主要讲什么？',
    '什么是核心概念？',
    '解释一下第三章的内容',
    '总结一下主要观点',
  ];

  return (
    <div className="page-container" style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>💬 智能问答</h1>
            <p>基于知识图谱的智能助手，为您解答文档相关问题</p>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-secondary" onClick={clearChat}>
              🗑️ 清空对话
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-message" style={{ flexShrink: 0 }}>
          <strong>错误:</strong> {error}
        </div>
      )}

      {/* Chat Container */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>
        {/* Messages Area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
          background: '#f8fafc'
        }}>
          {messages.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem 2rem' }}>
              <div className="empty-state-icon" style={{ fontSize: '4rem' }}>🤖</div>
              <h3>开始对话</h3>
              <p>问我任何关于文档内容的问题</p>

              {/* Suggested Questions */}
              <div style={{
                marginTop: '2rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem',
                maxWidth: '600px',
                margin: '2rem auto 0'
              }}>
                {suggestedQuestions.map((question) => (
                  <button
                    key={question}
                    className="btn btn-secondary"
                    onClick={() => setInput(question)}
                    style={{
                      textAlign: 'left',
                      fontSize: '0.875rem',
                      padding: '0.75rem 1rem'
                    }}
                  >
                    💬 {question}
                  </button>
                ))}
              </div>

              {/* Document Selector */}
              <div style={{ marginTop: '2rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  color: '#64748b',
                  marginBottom: '0.5rem'
                }}>
                  选择文档:
                </label>
                <select
                  className="form-select"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  style={{ width: 'auto', minWidth: '200px' }}
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
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: '0.75rem'
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: message.role === 'user' ? '#6366f1' : '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    flexShrink: 0,
                    order: message.role === 'user' ? 2 : 1
                  }}>
                    {message.role === 'user' ? '👤' : '🤖'}
                  </div>

                  {/* Message Bubble */}
                  <div style={{
                    maxWidth: '70%',
                    order: message.role === 'user' ? 1 : 2
                  }}>
                    <div style={{
                      background: message.role === 'user' ? '#6366f1' : 'white',
                      color: message.role === 'user' ? 'white' : '#374151',
                      padding: '1rem',
                      borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      boxShadow: message.role === 'user' ? 'none' : '0 1px 3px rgba(0,0,0,0.1)',
                      lineHeight: 1.6
                    }}>
                      {message.content}
                    </div>

                    {/* Metadata */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginTop: '0.375rem',
                      fontSize: '0.75rem',
                      color: '#94a3b8',
                      justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                    }}>
                      <span>{formatTime(message.timestamp)}</span>
                      {message.confidence !== undefined && (
                        <span style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          <span>置信度:</span>
                          <span style={{
                            color: message.confidence > 0.7 ? '#22c55e' : message.confidence > 0.4 ? '#f59e0b' : '#ef4444',
                            fontWeight: 500
                          }}>
                            {(message.confidence * 100).toFixed(0)}%
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Cited Concepts */}
                    {message.citedConcepts && message.citedConcepts.length > 0 && (
                      <div style={{
                        marginTop: '0.5rem',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.375rem',
                        justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                      }}>
                        {message.citedConcepts.map((conceptId) => (
                          <span
                            key={conceptId}
                            style={{
                              fontSize: '0.6875rem',
                              background: '#dbeafe',
                              color: '#1d4ed8',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '4px'
                            }}
                          >
                            概念 #{conceptId}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Loading Indicator */}
              {loading && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  gap: '0.75rem'
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem'
                  }}>
                    🤖
                  </div>
                  <div style={{
                    background: 'white',
                    padding: '1rem 1.25rem',
                    borderRadius: '16px 16px 16px 4px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{
                      width: '8px',
                      height: '8px',
                      background: '#cbd5e1',
                      borderRadius: '50%',
                      animation: 'bounce 1.4s infinite ease-in-out both',
                      animationDelay: '-0.32s'
                    }} />
                    <span style={{
                      width: '8px',
                      height: '8px',
                      background: '#cbd5e1',
                      borderRadius: '50%',
                      animation: 'bounce 1.4s infinite ease-in-out both',
                      animationDelay: '-0.16s'
                    }} />
                    <span style={{
                      width: '8px',
                      height: '8px',
                      background: '#cbd5e1',
                      borderRadius: '50%',
                      animation: 'bounce 1.4s infinite ease-in-out both'
                    }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          background: 'white'
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, fontSize: '0.9375rem' }}
                placeholder="输入您的问题..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !input.trim()}
                style={{ minWidth: '80px' }}
              >
                {loading ? '发送中...' : '发送'}
              </button>
            </div>
          </form>
          <div style={{
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: '#94a3b8',
            textAlign: 'center'
          }}>
            AI 生成的回答仅供参考，请核实重要信息
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};
