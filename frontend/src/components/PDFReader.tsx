import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { FileText } from 'lucide-react'
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
        const baseViewport = page.getViewport({ scale: 1 })
        const scaleFactor = (containerWidth - 40) / baseViewport.width
        const heightScaleFactor = (containerHeight - 40) / baseViewport.height

        // Use the smaller scale to ensure both width and height fit
        const scale = Math.min(scaleFactor, heightScaleFactor)
        // Pass rotation to handle rotated pages correctly
        const scaledViewport = page.getViewport({ scale, rotation: baseViewport.rotation })

        // Apply devicePixelRatio for sharp rendering on high-DPI displays
        const dpr = window.devicePixelRatio || 1
        canvas.width = scaledViewport.width * dpr
        canvas.height = scaledViewport.height * dpr
        canvas.style.width = `${scaledViewport.width}px`
        canvas.style.height = `${scaledViewport.height}px`

        // Scale context to match DPR
        context.scale(dpr, dpr)

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

  // Handle external page number navigation
  useEffect(() => {
    if (pageNumber && pageNumber !== currentPage && totalPages > 0) {
      const validPage = Math.max(1, Math.min(pageNumber, totalPages))
      setCurrentPage(validPage)
    }
  }, [pageNumber, currentPage, totalPages])

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
      {/* Header showing current page */}
      <div className="flex items-center justify-center p-3 border-b bg-muted/50">
        <div className="text-sm">
          Page {currentPage} of {totalPages}
        </div>
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