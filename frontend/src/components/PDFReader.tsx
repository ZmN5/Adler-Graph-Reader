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
  const [containerReady, setContainerReady] = useState(false)
  // Trigger to force re-render of visible pages after dimension recalculation
  const [recalcTrigger, setRecalcTrigger] = useState(0)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  // Keep ref in sync with state
  useEffect(() => {
    if (containerElement) {
      scrollContainerRef.current = containerElement
    }
  }, [containerElement])
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const renderingRef = useRef<Set<number>>(new Set())
  const scaleRef = useRef(1)
  const containerWidthRef = useRef(0)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  // Load PDF document only (dimension calculation happens in recalculate effect)
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setPdfDoc(null)
    pdfDocRef.current = null
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
        pdfDocRef.current = pdf
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF')
          setIsLoading(false)
        }
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [bookId])

  // Mark container as ready after mount
  useEffect(() => {
    setContainerReady(true)
  }, [])

  // Re-calculate page dimensions when container resizes
  useEffect(() => {
    if (!containerElement || !pdfDoc || !containerReady) return

    let rafId: number | null = null

    const recalculate = () => {
      // Cancel any pending recalculation
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }

      rafId = requestAnimationFrame(async () => {
        rafId = null
        const containerWidth = containerElement?.clientWidth
        const pdf = pdfDocRef.current
        if (!containerWidth || containerWidth < 100 || !pdf) return

        try {
          // Calculate new page dimensions
          const infos: PageInfo[] = []
          let totalH = 0

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const baseViewport = page.getViewport({ scale: 1 })

            // Calculate scale to fit container width with 20px padding
            // Multiply by devicePixelRatio and a clarity factor (2x) for high resolution rendering
            const dpr = window.devicePixelRatio || 1
            const clarityFactor = 2 // Additional clarity multiplier
            const scale = ((containerWidth - 20) / baseViewport.width) * dpr * clarityFactor
            const scaledViewport = page.getViewport({ scale, rotation: baseViewport.rotation })

            infos.push({
              pageNumber: i,
              width: scaledViewport.width / (dpr * clarityFactor), // Display size remains same
              height: scaledViewport.height / (dpr * clarityFactor),
              yOffset: totalH,
            })
            totalH += (scaledViewport.height / (dpr * clarityFactor)) + 10

            if (i === 1) {
              scaleRef.current = scale
              containerWidthRef.current = containerWidth
            }
          }

          setPageInfos(infos)
          setTotalHeight(totalH)
          setIsLoading(false) // Mark loading as complete after dimensions are calculated
          // Increment trigger to force scroll effect to re-run and re-render pages
          setRecalcTrigger(t => t + 1)

          // Clear rendered flag so pages re-render at new scale
          canvasRefs.current.forEach((canvas) => {
            canvas.dataset.rendered = 'false'
          })

          // Directly trigger scroll to re-render visible pages at new scale
          // This is necessary because React useEffect may not call handleScroll immediately
          const container = scrollContainerRef.current
          if (container) {
            requestAnimationFrame(() => {
              container.dispatchEvent(new Event('scroll'))
            })
          }
        } catch (err) {
          console.error('Failed to recalculate PDF dimensions:', err)
        }
      })
    }

    // Initial recalculation after a short delay to ensure layout is complete
    const initialTimeout = setTimeout(recalculate, 100)

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          recalculate()
          break
        }
      }
    })

    resizeObserver.observe(containerElement)

    return () => {
      clearTimeout(initialTimeout)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      resizeObserver.disconnect()
    }
  }, [pdfDoc, containerReady, containerElement])

  // Render a specific page to a canvas
  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdfDoc || renderingRef.current.has(pageNumber)) return

    const canvas = canvasRefs.current.get(pageNumber)
    if (!canvas) return

    // Check if already rendered
    const pageInfo = pageInfos[pageNumber - 1]
    if (!pageInfo) return

    // Get current container width for scale calculation
    const containerWidth = containerWidthRef.current || scrollContainerRef.current?.clientWidth || 800
    const padding = 20
    const page = await pdfDoc.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    const clarityFactor = 2 // Additional clarity multiplier for high resolution rendering
    const scale = ((containerWidth - padding) / baseViewport.width) * dpr * clarityFactor
    const scaledViewport = page.getViewport({ scale, rotation: baseViewport.rotation })

    // Check if canvas already has correct content by comparing with expected dimensions
    const expectedWidth = Math.floor(scaledViewport.width)
    if (canvas.width === expectedWidth && canvas.dataset.rendered === 'true') {
      return // Already rendered at this scale
    }

    renderingRef.current.add(pageNumber)

    try {
      canvas.width = scaledViewport.width
      canvas.height = scaledViewport.height
      canvas.style.width = `${scaledViewport.width / (dpr * clarityFactor)}px`
      canvas.style.height = `${scaledViewport.height / (dpr * clarityFactor)}px`

      const context = canvas.getContext('2d')!
      // No need to scale context since we're already at high resolution

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
  }, [pageInfos, renderPage, recalcTrigger])

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

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current page */}
      <div className="flex items-center justify-center p-3 border-b border-gray-200 bg-slate-50 flex-shrink-0">
        <div className="text-sm text-gray-500">
          {isLoading ? 'Loading...' : error ? 'Error' : `Page ${currentVisiblePage} of ${pageInfos.length || '?'}`}
        </div>
      </div>

      {/* Scroll container with virtual pages - always rendered so ref callback fires */}
      <div
        ref={(el) => {
          scrollContainerRef.current = el
          setContainerElement(el)
        }}
        className="flex-1 min-h-0 overflow-y-auto bg-white"
      >
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-apple-blue" />
            <span className="ml-3 text-gray-500 font-sans">Loading PDF...</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <FileText className="h-12 w-12 opacity-50" />
            <p className="mt-4 font-sans">Failed to load PDF</p>
            <p className="text-sm font-sans">{error}</p>
          </div>
        )}
        {!isLoading && !error && pageInfos.length === 0 && pdfDoc && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <FileText className="h-12 w-12 opacity-50" />
            <p className="mt-4 font-sans">No PDF document</p>
          </div>
        )}
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
                backgroundColor: '#FFFFFF',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                borderRadius: '4px',
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
