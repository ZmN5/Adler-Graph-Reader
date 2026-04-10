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
import { ModelSettings } from '@/components/ModelSettings'
import { StarField } from '@/components/StarField'
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

  // Handle Escape key to switch from Core Concepts back to Graph view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTab === 'core-concepts') {
        setActiveTab('graph')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab])

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

  const handleCloseDetailPanel = useCallback(() => {
    setSelectedNode(null)
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
      <div className="h-screen flex flex-col overflow-hidden starfield-bg">
        <StarField />
        
        {/* Header bar */}
        <div className="relative z-10 flex items-center justify-between border-b border-white/10 px-4 py-2 flex-shrink-0 glass-panel">
          <h1 className="text-lg font-space font-semibold text-white truncate">{selectedBook.title}</h1>
          <button
            onClick={handleCloseBook}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-space font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
            {t('app.close')}
          </button>
        </div>
        
        {/* Main content with starfield background */}
        <div className="relative z-0 flex-1 overflow-hidden">
          <StarField />
          
          <div className="relative z-10 h-full">
            <ThreeColumnLayout
              isLeftPanelCollapsed={isReaderCollapsed}
              onLeftPanelCollapseChange={setIsReaderCollapsed}
              leftPanelTitle={selectedBook.title}
              leftPanel={
                <div className="h-full bg-space-void/80">
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
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Tab navigation - space themed */}
                  <div className="flex items-center border-b bg-space-deep/50 border-white/10 flex-shrink-0">
                    <button
                      onClick={() => setActiveTab('graph')}
                      className={cn(
                        'space-tab',
                        activeTab === 'graph' && 'space-tab-active'
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
                        'space-tab',
                        activeTab === 'core-concepts' && 'space-tab-active'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4" />
                        {t('nav.coreConcepts')}
                      </div>
                    </button>
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-hidden relative">
                    <StarField className="opacity-50" />
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
              rightPanel={
                <NodeDetailPanel
                  node={selectedNode}
                  bookId={selectedBook.id}
                  onClose={handleCloseDetailPanel}
                  onViewInBook={handleViewInPDF}
                  onCitationClick={handleCitationClick}
                  onRelatedNodeClick={handleNodeClick}
                  bookFormat={isPdf ? 'pdf' : 'epub'}
                  className="h-full"
                />
              }
              showRightPanel={selectedNode !== null}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen starfield-bg relative overflow-hidden">
      <StarField />
      
      <div className="relative z-10">
        <Header onSettingsClick={() => setShowSettings(true)} />
        <MainContent>
          {showSettings ? (
            <div className="flex flex-col h-full">
              <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between flex-shrink-0 glass-panel">
                <h1 className="text-lg font-space font-semibold text-white">Settings</h1>
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-space font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors"
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
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 backdrop-blur-sm">
                  <p className="font-space">{error}</p>
                  <button
                    onClick={clearError}
                    className="mt-2 text-sm underline hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
                </div>
              )}
              <div className="flex flex-col items-center py-12">
                {/* Hero section */}
                <div className="text-center mb-12 animate-fade-in-up">
                  <h1 className="text-4xl font-orbitron font-bold text-white glow-text mb-4">
                    {t('app.hero.title')} <span className="text-gradient-cyan">{t('app.hero.subtitle')}</span>
                  </h1>
                  <p className="text-lg text-slate-400 font-space max-w-xl mx-auto">
                    {t('app.hero.description')}
                  </p>
                </div>
                
                <div className="w-full max-w-2xl">
                  <div className="mb-8">
                    <UploadButton onUploadSuccess={handleUploadSuccess} />
                  </div>
                  
                  <div className="mt-12">
                    <h2 className="text-lg font-space font-semibold mb-4 text-white flex items-center gap-2">
                      <span className="text-neon-cyan">◆</span>
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
