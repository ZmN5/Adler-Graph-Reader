import { Header } from '@/components/Header'
import { MainContent } from '@/components/MainContent'
import { UploadButton } from '@/components/UploadButton'
import { BookList } from '@/components/BookList'
import { PDFReader } from '@/components/PDFReader'
import { EPUBReader } from '@/components/EPUBReader'
import { GraphCanvas } from '@/components/GraphCanvas'
import { ThreeColumnLayout } from '@/components/ThreeColumnLayout'
import { NodeDetailPanel } from '@/components/NodeDetailPanel'
import { CoreConceptsList } from '@/components/CoreConceptsList'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import { useState, useCallback } from 'react'
import { UploadBookResponse, BookSummary, GraphNode } from '@/lib/api-client'
import { X, Network, Star } from 'lucide-react'

function App() {
  const { isLoading, error, clearError } = useAppStore()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [pdfPageNumber, setPdfPageNumber] = useState<number | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<'graph' | 'core-concepts'>('graph')

  const handleUploadSuccess = useCallback((_response: UploadBookResponse) => {
    setRefreshKey((k) => k + 1)
  }, [])

  const handleSelectBook = useCallback((book: BookSummary) => {
    setSelectedBook(book)
    setSelectedNode(null)
  }, [])

  const handleCloseBook = useCallback(() => {
    setSelectedBook(null)
    setSelectedNode(null)
    setPdfPageNumber(undefined)
  }, [])

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleViewInPDF = useCallback((pageNumber: number) => {
    setPdfPageNumber(pageNumber)
  }, [])

  const handleCloseDetailPanel = useCallback(() => {
    setSelectedNode(null)
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
          <ThreeColumnLayout
            leftPanel={
              isPdf ? (
                <PDFReader
                  bookId={selectedBook.id}
                  className="h-full"
                  pageNumber={pdfPageNumber}
                />
              ) : (
                <EPUBReader
                  bookId={selectedBook.id}
                  className="h-full"
                  pageNumber={pdfPageNumber}
                  totalPages={selectedBook.total_pages ?? undefined}
                />
              )
            }
            centerPanel={
              <div className="h-full flex flex-col">
                {/* Tab navigation */}
                <div className="flex items-center border-b bg-muted/50">
                  <button
                    onClick={() => setActiveTab('graph')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                      activeTab === 'graph'
                        ? 'text-primary border-b-2 border-primary bg-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    <Network className="h-4 w-4" />
                    Concept Graph
                  </button>
                  <button
                    onClick={() => setActiveTab('core-concepts')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                      activeTab === 'core-concepts'
                        ? 'text-primary border-b-2 border-primary bg-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    <Star className="h-4 w-4" />
                    Core Concepts
                  </button>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-hidden">
                  {activeTab === 'graph' ? (
                    <GraphCanvas
                      bookId={selectedBook.id}
                      className="h-full"
                      onNodeClick={handleNodeClick}
                      selectedNodeId={selectedNode?.id ?? null}
                    />
                  ) : (
                    <CoreConceptsList
                      bookId={selectedBook.id}
                      className="h-full overflow-auto p-4"
                      onNodeClick={(node) => {
                        setSelectedNode(node)
                        setActiveTab('graph')
                      }}
                      onViewInPDF={isPdf ? handleViewInPDF : undefined}
                    />
                  )}
                </div>
              </div>
            }
            rightPanel={
              <NodeDetailPanel
                node={selectedNode}
                bookId={selectedBook.id}
                onClose={handleCloseDetailPanel}
                onViewInPDF={isPdf ? handleViewInPDF : undefined}
                className="h-full"
              />
            }
            showRightPanel={selectedNode !== null}
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
