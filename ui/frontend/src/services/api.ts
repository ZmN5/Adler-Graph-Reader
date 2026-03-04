import axios, { AxiosInstance } from 'axios';
import type {
  Document,
  Concept,
  Relation,
  GraphNode,
  GraphLink,
  GraphData,
  SearchResult,
  QARequest,
  QAResponse,
  GraphStats,
} from '../types';

// Re-export types for backward compatibility
export type {
  Document,
  Concept,
  Relation,
  GraphNode,
  GraphLink,
  GraphData,
  SearchResult,
  QARequest,
  QAResponse,
  GraphStats,
};

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

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

// Response interceptor with better error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorMessage = error.response?.data?.detail || error.response?.data?.message || error.message;
    console.error('[API Error]', errorMessage);

    // Add status code for better error handling
    error.status = error.response?.status;
    error.message = errorMessage;

    return Promise.reject(error);
  }
);

// API functions
export const documentsApi = {
  getAll: async (): Promise<Document[]> => {
    const response = await apiClient.get('/documents');
    // Handle both { documents: [...], total: 2 } and [...] response formats
    return response.data.documents || response.data;
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
    // Handle both { concepts: [...], total: N } and [...] response formats
    return response.data.concepts || response.data;
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
    // Handle both { relations: [...], total: N } and [...] response formats
    return response.data.relations || response.data;
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
    const data = response.data;

    // Convert backend format (themes/concepts/relations) to frontend format (nodes/links)
    const nodes: GraphNode[] = [
      // Convert themes to nodes
      ...(data.themes || []).map((t: any) => ({
        id: `theme_${t.id}`,
        name: t.name,
        type: 'theme',
        description: t.description,
        confidence: t.importance_score,
      })),
      // Convert concepts to nodes
      ...(data.concepts || []).map((c: any) => ({
        id: `concept_${c.id}`,
        name: c.name,
        type: c.category || 'concept',
        description: c.definition,
        confidence: c.importance_score,
      })),
    ];

    // Convert relations to links
    const links: GraphLink[] = (data.relations || []).map((r: any) => ({
      source: `concept_${r.source_concept_id}`,
      target: `concept_${r.target_concept_id}`,
      type: r.relation_type,
      confidence: r.strength,
    }));

    return { nodes, links };
  },

  getStats: async (): Promise<GraphStats> => {
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
