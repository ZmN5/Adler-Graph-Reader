import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Types
export interface Document {
  id: string;
  title: string;
  content?: string;
  source_type: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface Concept {
  id: string;
  name: string;
  concept_type: string;
  description?: string;
  confidence: number;
  document_id: string;
  created_at: string;
}

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  confidence: number;
  document_id: string;
  created_at: string;
}

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
}

// API functions
export const documentsApi = {
  getAll: async (): Promise<Document[]> => {
    const response = await apiClient.get('/documents');
    return response.data;
  },

  getById: async (id: string): Promise<Document> => {
    const response = await apiClient.get(`/documents/${id}`);
    return response.data;
  },

  upload: async (file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },

  export: async (id: string, format: 'graphml' | 'gexf'): Promise<Blob> => {
    const response = await apiClient.get(`/documents/${id}/export?format=${format}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

export const conceptsApi = {
  getAll: async (): Promise<Concept[]> => {
    const response = await apiClient.get('/concepts');
    return response.data;
  },

  getByDocument: async (documentId: string): Promise<Concept[]> => {
    const response = await apiClient.get(`/concepts?document_id=${documentId}`);
    return response.data;
  },

  getById: async (id: string): Promise<Concept> => {
    const response = await apiClient.get(`/concepts/${id}`);
    return response.data;
  },
};

export const relationsApi = {
  getAll: async (): Promise<Relation[]> => {
    const response = await apiClient.get('/relations');
    return response.data;
  },

  getByDocument: async (documentId: string): Promise<Relation[]> => {
    const response = await apiClient.get(`/relations?document_id=${documentId}`);
    return response.data;
  },
};

export const graphApi = {
  getGraph: async (documentId?: string): Promise<GraphData> => {
    const url = documentId ? `/graph?document_id=${documentId}` : '/graph';
    const response = await apiClient.get(url);
    return response.data;
  },

  getStats: async (): Promise<{
    node_count: number;
    edge_count: number;
    concept_types: Record<string, number>;
    relation_types: Record<string, number>;
  }> => {
    const response = await apiClient.get('/graph/stats');
    return response.data;
  },
};

export const searchApi = {
  search: async (query: string, limit: number = 10): Promise<SearchResult> => {
    const response = await apiClient.get('/search', { params: { q: query, limit } });
    return response.data;
  },

  semanticSearch: async (query: string, limit: number = 10): Promise<SearchResult> => {
    const response = await apiClient.get('/search/semantic', { params: { q: query, limit } });
    return response.data;
  },
};

export const qaApi = {
  ask: async (request: QARequest): Promise<QAResponse> => {
    const response = await apiClient.post('/qa', request);
    return response.data;
  },
};

// Combined API object for convenience
export const api = {
  documents: documentsApi,
  concepts: conceptsApi,
  relations: relationsApi,
  graph: graphApi,
  qa: qaApi,
  
  // Additional methods expected by components
  getConcepts: async (params: { page?: number; page_size?: number; search?: string }) => {
    const response = await apiClient.get('/concepts', { params });
    return response.data;
  },
  
  getConcept: async (id: number) => {
    const response = await apiClient.get(`/concepts/${id}`);
    return response.data;
  },
  
  query: async (params: { question: string; document_id: string; session_id?: string }) => {
    const response = await apiClient.post('/qa', params);
    return response.data;
  },
  
  // Search method expected by SearchPage
  search: async (params: { query: string; document_id: string; top_k?: number; use_reranker?: boolean }) => {
    const response = await apiClient.post('/search', params);
    return response.data;
  },

  // Export graph
  exportGraph: async (documentId: string, format: 'json' | 'graphml' | 'gexf' | 'dot') => {
    const response = await apiClient.post('/graph/export', {
      document_id: documentId,
      format,
    });
    return response.data;
  },
};

export default apiClient;
