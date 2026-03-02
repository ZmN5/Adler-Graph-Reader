import { useEffect, useState } from 'react'
import { Layout, Select, Card, Statistic, Row, Col } from 'antd'
import GraphCanvas from './components/GraphCanvas'
import axios from 'axios'

const { Header, Content, Sider } = Layout

const API_BASE = 'http://localhost:8000'

interface Stats {
  chunks: number
  themes: number
  concepts: number
  relations: number
}

function App() {
  const [documents, setDocuments] = useState<string[]>([])
  const [selectedDoc, setSelectedDoc] = useState<string>('')
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    // Fetch documents list
    axios.get(`${API_BASE}/api/documents`)
      .then(res => {
        setDocuments(res.data)
        if (res.data.length > 0) {
          setSelectedDoc(res.data[0])
        }
      })
      .catch(err => console.error('Failed to fetch documents:', err))
  }, [])

  useEffect(() => {
    if (!selectedDoc) return
    
    // Fetch stats
    axios.get(`${API_BASE}/api/stats/${selectedDoc}`)
      .then(res => setStats(res.data))
      .catch(err => console.error('Failed to fetch stats:', err))
  }, [selectedDoc])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px' }}>
        <h1 style={{ margin: 0 }}>📚 Adler Graph Reader</h1>
      </Header>
      
      <Layout>
        <Sider width={300} style={{ background: '#f5f5f5', padding: 24 }}>
          <Card title="文档选择" size="small">
            <Select
              style={{ width: '100%' }}
              value={selectedDoc}
              onChange={setSelectedDoc}
              options={documents.map(d => ({ label: d, value: d }))}
            />
          </Card>
          
          {stats && (
            <Card title="统计信息" size="small" style={{ marginTop: 16 }}>
              <Row gutter={[8, 8]}>
                <Col span={12}>
                  <Statistic title="概念" value={stats.concepts} />
                </Col>
                <Col span={12}>
                  <Statistic title="关系" value={stats.relations} />
                </Col>
                <Col span={12}>
                  <Statistic title="主题" value={stats.themes} />
                </Col>
                <Col span={12}>
                  <Statistic title="块数" value={stats.chunks} />
                </Col>
              </Row>
            </Card>
          )}
        </Sider>
        
        <Content style={{ padding: 24 }}>
          {selectedDoc ? (
            <GraphCanvas documentId={selectedDoc} />
          ) : (
            <div style={{ textAlign: 'center', padding: 100 }}>
              请选择文档查看知识图谱
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  )
}

export default App
