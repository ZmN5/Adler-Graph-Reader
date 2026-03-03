import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import GraphPage from './components/GraphPage';
import DocumentsPage from './components/DocumentsPage';

// 临时占位页面
const SearchPage = () => (
  <div className="page-container">
    <h1>搜索</h1>
    <p>全文搜索 + 语义搜索功能即将上线...</p>
  </div>
);

const QAPage = () => (
  <div className="page-container">
    <h1>智能问答</h1>
    <p>基于知识图谱的问答功能即将上线...</p>
  </div>
);

const ConceptsPage = () => (
  <div className="page-container">
    <h1>概念管理</h1>
    <p>概念列表和详情功能即将上线...</p>
  </div>
);

const HomePage = () => (
  <div className="home-page">
    <div className="hero-section">
      <h1>📚 Adler Graph Reader</h1>
      <p className="subtitle">知识图谱可视化与文档分析平台</p>
      <div className="feature-cards">
        <Link to="/documents" className="feature-card">
          <div className="card-icon">📄</div>
          <h3>文档管理</h3>
          <p>导入、查看和管理您的文档</p>
        </Link>
        <Link to="/graph" className="feature-card">
          <div className="card-icon">🕸️</div>
          <h3>知识图谱</h3>
          <p>可视化展示文档中的概念关系</p>
        </Link>
        <Link to="/search" className="feature-card">
          <div className="card-icon">🔍</div>
          <h3>智能搜索</h3>
          <p>全文搜索与语义检索</p>
        </Link>
        <Link to="/qa" className="feature-card">
          <div className="card-icon">💬</div>
          <h3>问答系统</h3>
          <p>基于知识图谱的智能问答</p>
        </Link>
      </div>
    </div>
  </div>
);

function App() {
  return (
    <Router>
      <div className="app">
        <nav className="navbar">
          <div className="nav-brand">
            <Link to="/">🦞 Adler Graph Reader</Link>
          </div>
          <ul className="nav-links">
            <li><Link to="/">首页</Link></li>
            <li><Link to="/documents">文档</Link></li>
            <li><Link to="/graph">图谱</Link></li>
            <li><Link to="/concepts">概念</Link></li>
            <li><Link to="/search">搜索</Link></li>
            <li><Link to="/qa">问答</Link></li>
          </ul>
        </nav>
        
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/concepts" element={<ConceptsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/qa" element={<QAPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;