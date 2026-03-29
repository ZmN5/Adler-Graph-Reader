import { Header } from '@/components/Header'
import { MainContent } from '@/components/MainContent'
import { UploadButton } from '@/components/UploadButton'
import { BookList } from '@/components/BookList'
import { PDFReader } from '@/components/PDFReader'
import { EPUBReader } from '@/components/EPUBReader'
import { GraphCanvas } from '@/components/GraphCanvas'
import { SplitPane } from '@/components/SplitPane'
import { useAppStore } from '@/stores/app-store'
import { useState, useCallback } from 'react'
import { UploadBookResponse, BookSummary } from '@/lib/api-client'
import { X } from 'lucide-react'

function App() {
  const { isLoading, error, clearError } = useAppStore()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null)

  const handleUploadSuccess = useCallback((_response: UploadBookResponse) => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleSelectBook = useCallback((book: BookSummary) => {
    setSelectedBook(book)
  }, [])

  const handleCloseBook = useCallback(() => {
    setSelectedBook(null)
  }, [])

  // Show book detail view when a book is selected
  if (selectedBook) {
    const isPdf = selectedBook.format.toLowerCase() === 'pdf'
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h1 className="text-lg font-medium truncate">{selectedBook.title}</h1>
          <button
            onClick={handleCloseBook}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <SplitPane
            leftPane={
              isPdf ? (
                <PDFReader bookId={selectedBook.id} className="h-full" />
              ) : (
                <EPUBReader bookId={selectedBook.id} className="h-full" />
              )
            }
            rightPane={
              <GraphCanvas bookId={selectedBook.id} className="h-full" />
            }
            defaultSplit={50}
            storageKey="book-detail-layout"
          />
        </div>
      </div>
    )
  }

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
            <BookList key={refreshKey} onSelectBook={handleSelectBook} />
          </div>
        </div>
      </MainContent>
    </div>
  )
}

export default App
