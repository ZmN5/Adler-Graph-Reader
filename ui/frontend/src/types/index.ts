// Document types
export interface Document {
  id: string;
  title: string;
  content?: string;
  source_type: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

// Concept types
export interface Concept {
  id: string;
  name: string;
  concept_type: string;
  description?: string;
  confidence: number;
  document_id: string;
  created_at: string;
}

// Relation types
export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  confidence: number;
  document_id: string;
  created_at: string;
}

// Graph types
export interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  confidence?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Search types
export interface SearchResult {
  results: Array<{
    id: string;
    content: string;
    score: number;
    document_id: string;
    document_title: string;
  }>;
  total: number;
}

export interface SearchResultItem {
  tree_id: number;
  content: string;
  score: number;
  context: string[];
  page_number?: number;
}

// QA types
export interface QARequest {
  question: string;
  document_ids?: string[];
  top_k?: number;
}

export interface QAResponse {
  answer: string;
  sources: Array<{
    document_id: string;
    document_title: string;
    content: string;
    relevance_score: number;
  }>;
  session_id?: string;
  confidence?: number;
  cited_concept_ids?: number[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  confidence?: number;
  citedConcepts?: number[];
}

// API Response types
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  concept_types: Record<string, number>;
  relation_types: Record<string, number>;
}

// Component prop types
export interface GraphControllerProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode | null) => void;
  highlightedNode: string | null;
}

export interface PageLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}
