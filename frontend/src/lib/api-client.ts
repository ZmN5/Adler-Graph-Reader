// Use relative URL to work with Vite proxy in development
// In production, this should be set via environment variable
const API_BASE_URL = import.meta.env.PROD
  ? (import.meta.env.VITE_API_BASE_URL || '')
  : ''

export interface ApiResponse<T> {
  data: T
  error?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => null)
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      body
    )
  }

  return response.json() as Promise<T>
}

export async function apiGet<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })
  return handleResponse<T>(response)
}

export async function apiPost<T, R>(endpoint: string, body: T): Promise<R> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return handleResponse<R>(response)
}

export async function apiPut<T, R>(endpoint: string, body: T): Promise<R> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return handleResponse<R>(response)
}

export async function apiDelete<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  })
  return handleResponse<T>(response)
}

export type Language = 'zh' | 'en'

export interface LanguageResponse {
  language: Language
}

export async function getLanguage(): Promise<Language> {
  const response = await apiGet<LanguageResponse>('/api/settings/language')
  return response.language
}

export async function setLanguage(language: Language): Promise<void> {
  await apiPut<{ language: Language }, LanguageResponse>('/api/settings/language', { language })
}

// Book-related types
export interface BookSummary {
  id: string
  title: string
  author: string | null
  format: string
  total_pages: number | null
}

export interface BookDetails extends BookSummary {
  file_path: string
  created_at: string
}

export interface ExtractResponse {
  status: string
  nodes_count: number
  edges_count: number
}

export async function listBooks(): Promise<BookSummary[]> {
  return apiGet<BookSummary[]>('/api/books')
}

export async function getBook(bookId: string): Promise<BookDetails> {
  return apiGet<BookDetails>(`/api/books/${bookId}`)
}

export async function deleteBook(bookId: string): Promise<void> {
  await apiDelete<void>(`/api/books/${bookId}`)
}

export async function extractBook(bookId: string): Promise<ExtractResponse> {
  return apiPost<null, ExtractResponse>(`/api/books/${bookId}/extract`, null)
}

export interface ParseResponse {
  status: string
  chunks_created: number
  total_pages: number
}

export async function parseBook(bookId: string): Promise<ParseResponse> {
  return apiPost<null, ParseResponse>(`/api/books/${bookId}/parse`, null)
}

// Graph-related types
export interface GraphNode {
  id: string
  name: string
  description: string
  examples: string[]
  source_chunk_ids: string[]
  is_core: boolean
  category?: string
}

export interface GraphEdge {
  id: string
  source_node_id: string
  target_node_id: string
  relation_type: string
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export async function getBookGraph(bookId: string): Promise<GraphResponse> {
  return apiGet<GraphResponse>(`/api/books/${bookId}/graph`)
}

export async function getGlobalGraph(): Promise<GraphResponse> {
  return apiGet<GraphResponse>('/api/graph/global')
}

export interface NodeDetails extends GraphNode {
  book_id?: string
  language?: string
  category?: string
  page_number?: number
}

export async function getNode(nodeId: string): Promise<NodeDetails> {
  return apiGet<NodeDetails>(`/api/nodes/${nodeId}`)
}

// Core concepts API
export async function getCoreConcepts(bookId: string): Promise<GraphNode[]> {
  return apiGet<GraphNode[]>(`/api/books/${bookId}/core-concepts`)
}

// Chunk-related types and API
export interface ChunkDetails {
  id: string
  book_id: string
  page_start: number
  page_end: number
  content: string
  chapter_href?: string | null // For EPUB navigation
}

export async function getChunk(chunkId: string): Promise<ChunkDetails> {
  return apiGet<ChunkDetails>(`/api/chunks/${chunkId}`)
}

// Retrieval and Summary types
export interface RetrievalResult {
  chunk_id: string
  content: string
  page_start: number
  page_end: number
  vector_score: number
  bm25_score: number
  rrf_score: number
  final_score: number
}

export interface RetrievalResponse {
  chunks: RetrievalResult[]
  total_found: number
}

export interface Citation {
  index: number
  chunk_id: string
  page_start: number
  page_end: number
  excerpt: string
}

export interface SourceItem {
  index: number
  chunk_id: string
  page_start: number
  page_end: number
  content: string
}

export interface SummaryResponse {
  summary: string
  citations: Citation[]
  sources: SourceItem[]
}

export async function getNodeRetrieval(
  nodeId: string,
  topK: number = 10
): Promise<RetrievalResponse> {
  return apiGet<RetrievalResponse>(`/api/nodes/${nodeId}/retrieval?top_k=${topK}`)
}

export async function getNodeSummary(nodeId: string): Promise<SummaryResponse> {
  return apiGet<SummaryResponse>(`/api/nodes/${nodeId}/summary`)
}

export interface StreamChunk {
  type: 'content' | 'citation' | 'done' | 'error'
  text?: string
  index?: number
  chunk_id?: string
  page_start?: number
  page_end?: number
  excerpt?: string
  message?: string
}

export function getNodeSummaryStream(nodeId: string): Promise<AsyncGenerator<StreamChunk, void, unknown>> {
  return new Promise(async (resolve, reject) => {
    const API_BASE_URL = import.meta.env.PROD
      ? (import.meta.env.VITE_API_BASE_URL || '')
      : ''

    try {
      const response = await fetch(`${API_BASE_URL}/api/nodes/${nodeId}/summary/stream`, {
        headers: {
          'Accept': 'text/event-stream',
        },
      })

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      async function* generate(): AsyncGenerator<StreamChunk, void, unknown> {
        try {
          while (true) {
            const { done, value } = await reader!.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6)
                try {
                  const chunk: StreamChunk = JSON.parse(data)
                  yield chunk
                  if (chunk.type === 'done' || chunk.type === 'error') {
                    return
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', data)
                }
              }
            }
          }
        } finally {
          if (reader) {
            reader.releaseLock()
          }
        }
      }

      resolve(generate())
    } catch (error) {
      reject(error)
    }
  })
}

export type BookLanguage = 'auto' | 'zh' | 'en'

export interface UploadBookResponse {
  book_id: string
  title: string
}

export async function apiUploadBook(
  file: File,
  title: string,
  author?: string,
  language: BookLanguage = 'auto',
  onProgress?: (progress: number) => void
): Promise<UploadBookResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100)
        }
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid response format'))
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'))
    })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', title)
    formData.append('language', language)
    if (author) {
      formData.append('author', author)
    }

    xhr.open('POST', `${API_BASE_URL}/api/books/upload`)
    xhr.send(formData)
  })
}