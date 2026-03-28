import { Header } from '@/components/Header'
import { MainContent } from '@/components/MainContent'
import { UploadButton } from '@/components/UploadButton'
import { BookList } from '@/components/BookList'
import { useAppStore } from '@/stores/app-store'
import { useState, useCallback } from 'react'
import { UploadBookResponse } from '@/lib/api-client'

function App() {
  const { isLoading, error, clearError } = useAppStore()
  const [refreshKey, setRefreshKey] = useState(0)

  const handleUploadSuccess = useCallback((_response: UploadBookResponse) => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <MainContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-4 text-destructive">
            <p>{error}</p>
            <button
              onClick={clearError}
              className="mt-2 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
        <div className="flex flex-col items-center py-8">
          <h1 className="text-2xl font-bold">Welcome to Intelligent Reading Concept Graph</h1>
          <p className="mt-2 text-muted-foreground">
            Your AI-powered reading companion for building concept graphs
          </p>
          <div className="mt-8 w-full max-w-2xl">
            <UploadButton onUploadSuccess={handleUploadSuccess} />
          </div>
          <div className="mt-12 w-full max-w-2xl">
            <h2 className="text-lg font-semibold mb-4">Your Books</h2>
            <BookList key={refreshKey} />
          </div>
        </div>
      </MainContent>
    </div>
  )
}

export default App