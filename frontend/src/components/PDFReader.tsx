import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { FileText, List, ChevronLeft, ChevronDown } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

interface PDFReaderProps {
  bookId: string
  className?: string
  highlightChunkId?: string | null
  /** Text to search and highlight on the page */
  highlightText?: string | null
  /** External page number to navigate to */
  pageNumber?: number
}

interface PageInfo {
  pageNumber: number
  width: number
  height: number
  yOffset: number
}

interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
}

interface TocItem {
  title: string
  pageNumber: number
  depth: number
}

export function PDFReader({
  bookId,
  className,
  highlightChunkId,
  highlightText,
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
  // Highlight state: page number -> array of highlight rects
  const [pageHighlights, setPageHighlights] = useState<Map<number, HighlightRect[]>>(new Map())
  // PDF outline (table of contents)
  const [outline, setOutline] = useState<TocItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)

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
  const highlightTextRef = useRef(highlightText)
  highlightTextRef.current = highlightText

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
    setPageHighlights(new Map())

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

  // Load PDF outline (table of contents) after document loads
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false

    const loadOutline = async () => {
      try {
        const outlineNodes = await pdfDoc.getOutline()
        if (!outlineNodes || outlineNodes.length === 0) return
        if (cancelled) return

        const flatten = async (items: any[], depth = 0): Promise<TocItem[]> => {
          const result: TocItem[] = []
          for (const item of items) {
            let pageNumber = 0
            if (item.dest) {
              try {
                let destArray: any
                if (typeof item.dest === 'string') {
                  destArray = await pdfDoc.getDestination(item.dest)
                } else {
                  destArray = item.dest
                }
                if (destArray && destArray[0]) {
                  // Try getPageIndex first (handles page ref objects)
                  const pageIndex = await pdfDoc.getPageIndex(destArray[0])
                  if (pageIndex >= 0) {
                    pageNumber = pageIndex + 1
                  } else if (typeof destArray[0] === 'number' && destArray[0] >= 0) {
                    // Fallback: some PDFs use a direct page number in the dest array
                    pageNumber = destArray[0] + 1
                  }
                }
              } catch (err) {
                console.warn(`Failed to resolve destination for TOC item "${item.title}":`, err)
              }
            }
            result.push({ title: item.title, pageNumber, depth })
            if (item.items && item.items.length > 0) {
              const children = await flatten(item.items, depth + 1)
              result.push(...children)
            }
          }
          return result
        }

        const toc = await flatten(outlineNodes)
        if (!cancelled) {
          setOutline(toc.filter((item) => item.pageNumber > 0))
        }
      } catch (err) {
        console.error('Failed to load PDF outline:', err)
      }
    }

    loadOutline()

    return () => {
      cancelled = true
    }
  }, [pdfDoc])

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

  // Navigate to a specific page (used by TOC and external props)
  const goToPage = useCallback((targetPage: number) => {
    if (!scrollContainerRef.current) {
      console.warn('Cannot navigate: scroll container not ready')
      return
    }
    if (pageInfos.length === 0) {
      console.warn('Cannot navigate: page dimensions not yet calculated')
      return
    }
    const validPage = Math.max(1, Math.min(targetPage, pageInfos.length))
    const pageInfo = pageInfos[validPage - 1]
    if (pageInfo) {
      scrollContainerRef.current.scrollTo({
        top: pageInfo.yOffset,
        behavior: 'smooth',
      })
      setTocOpen(false)
    }
  }, [pageInfos])

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

  // Search and highlight text when highlightText changes
  useEffect(() => {
    if (!pdfDoc || pageInfos.length === 0 || !highlightText) {
      if (!highlightText) setPageHighlights(new Map())
      return
    }

    const searchAndHighlight = async () => {
      const newHighlights = new Map<number, HighlightRect[]>()
      const search = highlightText.trim()
      if (!search) {
        setPageHighlights(newHighlights)
        return
      }

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum)
          const textContent = await page.getTextContent()
          const items = textContent.items as TextItem[]

          // Build full page text and map positions to items
          let fullText = ''
          const itemRanges: { item: TextItem; start: number; end: number }[] = []

          for (const item of items) {
            const start = fullText.length
            fullText += item.str
            itemRanges.push({ item, start, end: fullText.length })
          }

          // Search for highlight text
          let matchIndex = fullText.indexOf(search)
          if (matchIndex === -1) {
            // Fallback: search for first 60 chars
            const fallback = search.slice(0, 60).trim()
            if (fallback.length >= 10) {
              matchIndex = fullText.indexOf(fallback)
            }
          }

          if (matchIndex === -1) continue

          const pageInfo = pageInfos.find(p => p.pageNumber === pageNum)
          if (!pageInfo) continue

          const baseViewport = page.getViewport({ scale: 1 })
          const displayScale = pageInfo.width / baseViewport.width

          const matchStart = matchIndex
          const matchEnd = matchIndex + search.length
          const rects: HighlightRect[] = []

          for (const { item, start, end } of itemRanges) {
            if (end <= matchStart || start >= matchEnd) continue

            const transform = item.transform
            const itemX = transform[4]
            const itemY = transform[5]

            // Calculate overlap ratio within this item
            const overlapStart = Math.max(start, matchStart)
            const overlapEnd = Math.min(end, matchEnd)
            const charStart = overlapStart - start
            const charEnd = overlapEnd - start
            const ratio = charEnd > charStart ? (charEnd - charStart) / item.str.length : 1

            // Convert to display coordinates
            const x = itemX * displayScale
            const y = (baseViewport.height - itemY) * displayScale
            const w = item.width * ratio * displayScale
            const h = item.height * displayScale

            rects.push({
              left: x,
              top: y - h * 0.8,
              width: w,
              height: h * 1.2,
            })
          }

          if (rects.length > 0) {
            newHighlights.set(pageNum, rects)
          }
        } catch (err) {
          console.error(`Failed to highlight page ${pageNum}:`, err)
        }
      }

      setPageHighlights(newHighlights)

      // Scroll to first highlight
      for (const [pageNum, rects] of newHighlights) {
        if (rects.length > 0) {
          const pageInfo = pageInfos.find(p => p.pageNumber === pageNum)
          if (pageInfo && scrollContainerRef.current) {
            const targetY = pageInfo.yOffset + rects[0].top - 50
            scrollContainerRef.current.scrollTo({
              top: Math.max(0, targetY),
              behavior: 'smooth',
            })
          }
          break
        }
      }
    }

    searchAndHighlight()
  }, [pdfDoc, pageInfos, highlightText])

  // Highlight chunk ID logging (kept for debugging)
  useEffect(() => {
    if (highlightChunkId) {
      console.log('Highlight chunk:', highlightChunkId)
    }
  }, [highlightChunkId])

  // Determine which TOC item corresponds to the currently visible page
  const activeTocIndex = useMemo(() => {
    let activeIndex = -1
    let maxPage = -1
    for (let i = 0; i < outline.length; i++) {
      const item = outline[i]
      if (item.pageNumber > 0 && item.pageNumber <= currentVisiblePage && item.pageNumber > maxPage) {
        maxPage = item.pageNumber
        activeIndex = i
      }
    }
    return activeIndex
  }, [outline, currentVisiblePage])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current page */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-slate-50 flex-shrink-0">
        {outline.length > 0 ? (
          <button
            onClick={() => setTocOpen(!tocOpen)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-sans font-medium transition-colors border',
              tocOpen
                ? 'bg-apple-blue text-white border-apple-blue'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-slate-100'
            )}
            aria-label={tocOpen ? 'Close contents' : 'Open contents'}
            title={tocOpen ? 'Close contents' : 'Open contents'}
          >
            <List className="w-4 h-4" />
            <span>目录</span>
          </button>
        ) : (
          <div className="w-[72px] flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm text-gray-500">
            {isLoading ? 'Loading...' : error ? 'Error' : `Page ${currentVisiblePage} of ${pageInfos.length || '?'}`}
          </div>
        </div>

        <div className="w-[72px] flex-shrink-0" />
      </div>

      {/* Main content: TOC sidebar + scroll container */}
      <div className="flex flex-1 min-h-0">
        {/* TOC Sidebar */}
        <div
          className={cn(
            'flex-shrink-0 border-r border-gray-200 bg-white transition-all duration-300 ease-in-out overflow-hidden',
            tocOpen ? 'w-[260px] opacity-100' : 'w-0 opacity-0'
          )}
        >
          <div className="w-[260px] h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-slate-50">
              <span className="text-sm font-semibold text-gray-700">Contents</span>
              <button
                onClick={() => setTocOpen(false)}
                className="p-1 rounded-md hover:bg-slate-200 transition-colors"
                aria-label="Close contents"
              >
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {outline.map((item, index) => {
                const isActive = index === activeTocIndex
                const pagesReady = pageInfos.length > 0
                return (
                  <button
                    key={index}
                    onClick={() => goToPage(item.pageNumber)}
                    disabled={!pagesReady}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm font-sans transition-colors flex items-center gap-1',
                      !pagesReady && 'opacity-40 cursor-not-allowed',
                      isActive && pagesReady
                        ? 'bg-apple-blue/10 text-apple-blue font-medium'
                        : pagesReady
                          ? 'text-gray-700 hover:bg-slate-50'
                          : 'text-gray-400'
                    )}
                    style={{ paddingLeft: `${16 + item.depth * 16}px` }}
                  >
                    {item.depth > 0 && (
                      <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </button>
                )
              })}
            </div>
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
              {/* Highlight overlay layer */}
              {pageHighlights.get(pageInfo.pageNumber)?.map((rect, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    backgroundColor: 'rgba(255, 215, 0, 0.35)',
                    borderRadius: '2px',
                    pointerEvents: 'none',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
