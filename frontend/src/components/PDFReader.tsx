import { useState, useEffect, useRef, useCallback } from 'react'
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

interface PageInfo {
  pageNumber: number
  width: number
  height: number
  yOffset: number
}

export function PDFReader({
  bookId,
  className,
  highlightChunkId,
  pageNumber,
}: PDFReaderProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([])
  const [totalHeight, setTotalHeight] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const renderingRef = useRef<Set<number>>(new Set())
  const scaleRef = useRef(1)

  // Load PDF document and calculate page dimensions
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setPageInfos([])
    setTotalHeight(0)
    renderingRef.current.clear()

    const loadPdf = async () => {
      try {
        const fullUrl = `/api/books/${bookId}/file`
        const loadingTask = pdfjsLib.getDocument({
          url: fullUrl,
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        })

        const pdf = await loadingTask.promise
        if (cancelled) return

        setPdfDoc(pdf)

        // Get container width for scaling calculation
        const containerWidth = scrollContainerRef.current?.clientWidth || 800

        // Calculate page dimensions for all pages
        const infos: PageInfo[] = []
        let totalH = 0

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const baseViewport = page.getViewport({ scale: 1 })

          // Calculate scale to fit container width with less padding (20px instead of 40px)
          const scale = (containerWidth - 20) / baseViewport.width
          const scaledViewport = page.getViewport({ scale, rotation: baseViewport.rotation })

          const info: PageInfo = {
            pageNumber: i,
            width: scaledViewport.width,
            height: scaledViewport.height,
            yOffset: totalH,
          }
          infos.push(info)
          totalH += scaledViewport.height + 20 // 20px gap between pages

          // Store scale for rendering
          if (i === 1) {
            scaleRef.current = scale
          }
        }

        if (!cancelled) {
          setPageInfos(infos)
          setTotalHeight(totalH)
          setCurrentVisiblePage(1)
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

  // Render a specific page to a canvas
  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdfDoc || renderingRef.current.has(pageNumber)) return

    const canvas = canvasRefs.current.get(pageNumber)
    if (!canvas) return

    // Check if already rendered
    const pageInfo = pageInfos[pageNumber - 1]
    if (!pageInfo) return

    // Check if canvas already has content by checking if dimensions match
    const expectedWidth = Math.floor(pageInfo.width * (window.devicePixelRatio || 1))
    if (canvas.width === expectedWidth && canvas.dataset.rendered === 'true') {
      return // Already rendered
    }

    renderingRef.current.add(pageNumber)

    try {
      const page = await pdfDoc.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = scaleRef.current
      const scaledViewport = page.getViewport({ scale, rotation: baseViewport.rotation })

      const dpr = window.devicePixelRatio || 1
      canvas.width = scaledViewport.width * dpr
      canvas.height = scaledViewport.height * dpr
      canvas.style.width = `${scaledViewport.width}px`
      canvas.style.height = `${scaledViewport.height}px`

      const context = canvas.getContext('2d')!
      context.scale(dpr, dpr)

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      }).promise

      canvas.dataset.rendered = 'true'
    } catch (err) {
      console.error(`Failed to render page ${pageNumber}:`, err)
    } finally {
      renderingRef.current.delete(pageNumber)
    }
  }, [pdfDoc, pageInfos])

  // Handle scroll events for virtual scrolling
  useEffect(() => {
    if (!scrollContainerRef.current || pageInfos.length === 0) return

    const container = scrollContainerRef.current
    const containerHeight = container.clientHeight

    const handleScroll = () => {
      const scrollTop = container.scrollTop

      // Find visible pages based on scroll position
      const visibleRange = {
        start: scrollTop - 100,
        end: scrollTop + containerHeight + 100,
      }

      // Find current page for header
      for (const info of pageInfos) {
        if (scrollTop >= info.yOffset && scrollTop < info.yOffset + info.height + 20) {
          setCurrentVisiblePage(info.pageNumber)
          break
        }
      }

      // Render visible pages
      for (const info of pageInfos) {
        const pageTop = info.yOffset
        const pageBottom = info.yOffset + info.height

        // Check if page is in visible range
        if (pageBottom >= visibleRange.start && pageTop <= visibleRange.end) {
          renderPage(info.pageNumber)
        }
      }
    }

    // Initial render
    handleScroll()

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [pageInfos, renderPage])

  // Handle external page number navigation
  useEffect(() => {
    if (pageNumber && scrollContainerRef.current && pageInfos.length > 0) {
      const validPage = Math.max(1, Math.min(pageNumber, pageInfos.length))
      const pageInfo = pageInfos[validPage - 1]
      if (pageInfo) {
        scrollContainerRef.current.scrollTo({
          top: pageInfo.yOffset,
          behavior: 'smooth',
        })
      }
    }
  }, [pageNumber, pageInfos])

  // Highlight handling
  useEffect(() => {
    if (highlightChunkId) {
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

  if (!pdfDoc || pageInfos.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-muted-foreground', className)}>
        <FileText className="h-12 w-12 opacity-50" />
        <p className="mt-4">No PDF document</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current page */}
      <div className="flex items-center justify-center p-3 border-b bg-muted/50">
        <div className="text-sm">
          Page {currentVisiblePage} of {pageInfos.length}
        </div>
      </div>

      {/* Scroll container with virtual pages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {pageInfos.map((pageInfo) => (
            <div
              key={pageInfo.pageNumber}
              style={{
                position: 'absolute',
                top: pageInfo.yOffset,
                left: '50%',
                transform: 'translateX(-50%)',
                width: pageInfo.width,
                height: pageInfo.height,
                backgroundColor: '#f5f5f5',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            >
              <canvas
                ref={(el) => {
                  if (el) {
                    canvasRefs.current.set(pageInfo.pageNumber, el)
                  }
                }}
                style={{
                  width: '100%',
                  height: '100%',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
