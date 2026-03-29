import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

interface PDFReaderProps {
  bookId: string
  className?: string
  highlightChunkId?: string | null
  /** External page number to navigate to */
  pageNumber?: number
}

export function PDFReader({
  bookId,
  className,
  highlightChunkId,
  pageNumber,
}: PDFReaderProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageInputValue, setPageInputValue] = useState('1')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load PDF document
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    const loadPdf = async () => {
      try {
        // Use the API endpoint to get the file
        const fullUrl = `/api/books/${bookId}/file`
        const loadingTask = pdfjsLib.getDocument({
          url: fullUrl,
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        })

        const pdf = await loadingTask.promise
        if (!cancelled) {
          setPdfDoc(pdf)
          setTotalPages(pdf.numPages)
          setCurrentPage(1)
          setPageInputValue('1')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [bookId])

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return

    // Capture container dimensions synchronously (refs are available after render)
    const container = containerRef.current
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight - 60 // Account for header height (approx 60px)

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage)
        const canvas = canvasRef.current!
        const context = canvas.getContext('2d')!

        // Calculate scale to fit container width with padding
        const viewport = page.getViewport({ scale: 1 })
        const scaleFactor = (containerWidth - 40) / viewport.width
        const heightScaleFactor = (containerHeight - 40) / viewport.height

        // Use the smaller scale to ensure both width and height fit
        const scale = Math.min(scaleFactor, heightScaleFactor)
        const scaledViewport = page.getViewport({ scale })

        canvas.height = scaledViewport.height
        canvas.width = scaledViewport.width

        await page.render({
          canvasContext: context,
          viewport: scaledViewport,
        }).promise
      } catch (err) {
        console.error('Failed to render page:', err)
      }
    }

    renderPage()
  }, [pdfDoc, currentPage])

  const goToPage = useCallback((page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(validPage)
    setPageInputValue(String(validPage))
  }, [totalPages])

  const handlePrevPage = useCallback(() => {
    goToPage(currentPage - 1)
  }, [currentPage, goToPage])

  const handleNextPage = useCallback(() => {
    goToPage(currentPage + 1)
  }, [currentPage, goToPage])

  const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value)
  }, [])

  const handlePageInputBlur = useCallback(() => {
    const page = parseInt(pageInputValue, 10)
    if (!isNaN(page)) {
      goToPage(page)
    } else {
      setPageInputValue(String(currentPage))
    }
  }, [pageInputValue, currentPage, goToPage])

  const handlePageInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handlePageInputBlur()
    }
  }, [handlePageInputBlur])

  // Handle external page number navigation
  useEffect(() => {
    if (pageNumber && pageNumber !== currentPage && totalPages > 0) {
      goToPage(pageNumber)
    }
  }, [pageNumber, currentPage, totalPages, goToPage])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePrevPage()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        handleNextPage()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePrevPage, handleNextPage])

  // Highlight handling - for now just a placeholder since we'd need chunk data
  useEffect(() => {
    if (highlightChunkId) {
      // TODO: Find and highlight the chunk in the PDF
      // This requires getting chunk info from the API and finding the text in the PDF
      console.log('Highlight chunk:', highlightChunkId)
    }
  }, [highlightChunkId])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="ml-3 text-muted-foreground">Loading PDF...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-destructive', className)}>
        <FileText className="h-12 w-12 opacity-50" />
        <p className="mt-4">Failed to load PDF</p>
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (!pdfDoc) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-muted-foreground', className)}>
        <FileText className="h-12 w-12 opacity-50" />
        <p className="mt-4">No PDF document</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-center gap-4 p-3 border-b bg-muted/50">
        <button
          onClick={handlePrevPage}
          disabled={currentPage <= 1}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            'bg-background border hover:bg-muted',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm">Page</span>
          <input
            type="text"
            value={pageInputValue}
            onChange={handlePageInputChange}
            onBlur={handlePageInputBlur}
            onKeyDown={handlePageInputKeyDown}
            className={cn(
              'w-12 h-8 text-center rounded-md border bg-background',
              'focus:outline-none focus:ring-2 focus:ring-primary'
            )}
          />
          <span className="text-sm">of {totalPages}</span>
        </div>

        <button
          onClick={handleNextPage}
          disabled={currentPage >= totalPages}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            'bg-background border hover:bg-muted',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-5 flex justify-center items-start">
        <canvas
          ref={canvasRef}
          className="shadow-lg max-w-full h-auto"
        />
      </div>
    </div>
  )
}