const API_BASE_URL = 'http://localhost:8080'

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

export interface UploadBookResponse {
  book_id: string
  title: string
}

export async function apiUploadBook(
  file: File,
  title: string,
  author?: string,
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
    if (author) {
      formData.append('author', author)
    }

    xhr.open('POST', `${API_BASE_URL}/api/books/upload`)
    xhr.send(formData)
  })
}