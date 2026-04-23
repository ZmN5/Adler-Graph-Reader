import { Header } from '@/components/Header'
import { MainContent } from '@/components/MainContent'
import { UploadButton } from '@/components/UploadButton'
import { BookList } from '@/components/BookList'
import { PDFReader } from '@/components/PDFReader'
import { EPUBReader } from '@/components/EPUBReader'
import { GraphCanvas } from '@/components/GraphCanvas'
import { ThreeColumnLayout } from '@/components/ThreeColumnLayout'
import { ChatPanel } from '@/components/ChatPanel'
import { CoreConceptsList } from '@/components/CoreConceptsList'
import { ModelSettings } from '@/components/ModelSettings'
import { useAppStore } from '@/stores/app-store'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useState, useCallback, useEffect } from 'react'
import { UploadBookResponse, BookSummary, GraphNode, getChunk } from '@/lib/api-client'
import { X, Network, Star } from 'lucide-react'

function App() {
  const { isLoading, error, clearError } = useAppStore()
  const { t } = useTranslation()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [pdfPageNumber, setPdfPageNumber] = useState<number | undefined>(undefined)
  const [epubChapterHref, setEpubChapterHref] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'graph' | 'core-concepts'>('graph')
  const [highlightChunkId, setHighlightChunkId] = useState<string | null>(null)
  const [isReaderCollapsed, setIsReaderCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Handle Escape key to close modals and switch views
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false)
        } else if (activeTab === 'core-concepts') {
          setActiveTab('graph')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, showSettings])

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
    setEpubChapterHref(null)
  }, [])

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleViewInPDF = useCallback((pageNumber: number) => {
    setPdfPageNumber(pageNumber)
  }, [])

  const handleCitationClick = useCallback(async (chunkId: string) => {
    if (!selectedBook) return

    try {
      // Get chunk details to find the page number
      const chunk = await getChunk(chunkId)

      // Set highlight chunk ID for both PDF and EPUB
      setHighlightChunkId(chunkId)

      // Navigate to the page/chapter
      if (selectedBook.format.toLowerCase() === 'pdf') {
        // For PDF, use page number directly
        if (chunk.page_start > 0) {
          setPdfPageNumber(chunk.page_start)
        }
      } else {
        // For EPUB, use chapter_href for direct navigation
        if (chunk.chapter_href) {
          setEpubChapterHref(chunk.chapter_href)
        }
      }
    } catch (err) {
      console.error('Failed to handle citation click:', err)
    }
  }, [selectedBook])

  // Show book detail view when a book is selected
  if (selectedBook) {
    const isPdf = selectedBook.format.toLowerCase() === 'pdf'
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        {/* Header bar */}
        <div className="relative z-10 flex items-center justify-between border-b border-gray-200 px-4 py-2 flex-shrink-0 bg-white shadow-apple-sm">
          <h1 className="text-base font-sans font-semibold text-gray-900 truncate">{selectedBook.title}</h1>
          <button
            onClick={handleCloseBook}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-sans font-medium bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <X className="h-4 w-4" />
            {t('app.close')}
          </button>
        </div>

        {/* Main content */}
        <div className="relative z-0 flex-1 overflow-hidden">
          <div className="relative z-10 h-full">
            <ThreeColumnLayout
              isLeftPanelCollapsed={isReaderCollapsed}
              onLeftPanelCollapseChange={setIsReaderCollapsed}
              leftPanelTitle={selectedBook.title}
              leftPanel={
                <div className="h-full bg-white">
                  {isPdf ? (
                    <PDFReader
                      bookId={selectedBook.id}
                      className="h-full"
                      pageNumber={pdfPageNumber}
                      highlightChunkId={highlightChunkId}
                    />
                  ) : (
                    <EPUBReader
                      bookId={selectedBook.id}
                      className="h-full"
                      chapterHref={epubChapterHref}
                      totalPages={selectedBook.total_pages ?? undefined}
                      highlightAnchor={null}
                    />
                  )}
                </div>
              }
              centerPanel={
                <ChatPanel
                  bookId={selectedBook.id}
                  selectedNode={selectedNode}
                  onCitationClick={handleCitationClick}
                  className="h-full"
                />
              }
              rightPanel={
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Tab navigation */}
                  <div className="flex items-center border-b bg-white border-gray-200 flex-shrink-0">
                    <button
                      onClick={() => setActiveTab('graph')}
                      className={cn(
                        'apple-tab',
                        activeTab === 'graph' && 'apple-tab-active'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Network className="h-4 w-4" />
                        {t('nav.conceptGraph')}
                      </div>
                    </button>
                    <button
                      onClick={() => setActiveTab('core-concepts')}
                      className={cn(
                        'apple-tab',
                        activeTab === 'core-concepts' && 'apple-tab-active'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4" />
                        {t('nav.coreConcepts')}
                      </div>
                    </button>
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-hidden relative bg-slate-50">
                    <div className="relative z-10 h-full">
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
                          onViewInBook={handleViewInPDF}
                          bookFormat={isPdf ? 'pdf' : 'epub'}
                        />
                      )}
                    </div>
                  </div>
                </div>
              }
              showRightPanel={true}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white relative overflow-hidden">
      <div className="relative z-10">
        <Header onSettingsClick={() => setShowSettings(true)} />
        <MainContent>
          {showSettings ? (
            <div className="flex flex-col h-full">
              <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0 bg-white shadow-apple-sm">
                <h1 className="text-base font-sans font-semibold text-gray-900">Settings</h1>
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-sans font-medium bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <X className="h-4 w-4" />
                  {t('app.close')}
                </button>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <ModelSettings />
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-600">
                  <p className="font-sans">{error}</p>
                  <button
                    onClick={clearError}
                    className="mt-2 text-sm underline hover:text-red-800 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
                </div>
              )}
              <div className="flex flex-col items-center py-12">
                {/* Hero section */}
                <div className="text-center mb-12 animate-fade-in">
                  <h1 className="text-3xl font-sans font-bold text-gray-900 mb-4 tracking-tight">
                    {t('app.hero.title')} <span className="text-apple-blue">{t('app.hero.subtitle')}</span>
                  </h1>
                  <p className="text-base text-gray-500 font-sans max-w-xl mx-auto leading-relaxed">
                    {t('app.hero.description')}
                  </p>
                </div>

                <div className="w-full max-w-2xl">
                  <div className="mb-8">
                    <UploadButton onUploadSuccess={handleUploadSuccess} />
                  </div>

                  <div className="mt-12">
                    <h2 className="text-base font-sans font-semibold mb-4 text-gray-900 flex items-center gap-2">
                      <span className="text-apple-blue">◆</span>
                      {t('app.library.title')}
                    </h2>
                    <BookList
                      key={refreshKey}
                      onSelectBook={handleSelectBook}
                      className="max-w-2xl mx-auto"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </MainContent>
      </div>
    </div>
  )
}

export default App
