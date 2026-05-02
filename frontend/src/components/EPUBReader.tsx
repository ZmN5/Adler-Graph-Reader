import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ReactReader } from 'react-reader'
import type { Rendition, Book, Contents } from 'epubjs'
import type { IReactReaderStyle } from 'react-reader'
import { List, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

interface EPUBReaderProps {
  bookId: string
  className?: string
  highlightAnchor?: string | null
  /** Text to search and highlight within chapters */
  highlightText?: string | null
  /** External page number to navigate to (approximate for EPUB based on percentage) */
  pageNumber?: number
  /** Total pages for calculating percentage position in EPUB */
  totalPages?: number
  /** Chapter href to navigate to directly (from chunk.chapter_href) */
  chapterHref?: string | null
}

interface Chapter {
  id: string
  href: string
  label: string
  depth: number
}

// Custom styles to hide prev/next navigation buttons
const readerStyles: IReactReaderStyle = {
  container: {},
  readerArea: {},
  containerExpanded: {},
  titleArea: {},
  reader: {},
  swipeWrapper: {},
  prev: { display: 'none' },
  next: { display: 'none' },
  arrow: {},
  arrowHover: {},
  tocBackground: {},
  toc: {},
  tocArea: {},
  tocAreaButton: {},
  tocButton: {},
  tocButtonExpanded: {},
  tocButtonBar: {},
  tocButtonBarTop: {},
  loadingView: {},
  errorView: {},
  tocButtonBottom: {},
}

export function EPUBReader({
  bookId,
  className,
  highlightAnchor,
  highlightText,
  pageNumber,
  totalPages: totalPagesProp,
  chapterHref,
}: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0)
  const [currentChapter, setCurrentChapter] = useState<string>('Unknown')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentChapterHref, setCurrentChapterHref] = useState<string | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const tocRef = useRef<Chapter[]>([])
  const [isRenditionReady, setIsRenditionReady] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const eventCleanupRef = useRef<Array<() => void>>([])
  const highlightAnnotationRef = useRef<string | null>(null)
  const pendingHighlightRef = useRef<string | null>(null)

  const bookUrl = `/api/books/${bookId}/file`

  // Handle location changes from react-reader / epubjs
  const locationChanged = useCallback((loc: string) => {
    // Always update location state so react-reader tracks the current position
    setLocation(loc)

    // Update current chapter based on location
    if (tocRef.current.length > 0) {
      const rendition = renditionRef.current
      if (!rendition) return

      const locResult = rendition.currentLocation()
      const handleLocObj = (result: { start?: { href?: string } }) => {
        const currentHref = result?.start?.href
        if (currentHref) {
          const chapter = tocRef.current.find((c) =>
            currentHref.toLowerCase().includes(c.href.toLowerCase()) ||
            c.href.toLowerCase().includes(currentHref.toLowerCase())
          )
          if (chapter) {
            setCurrentChapter(chapter.label)
            setCurrentChapterHref(chapter.href)
          }
        }
      }
      Promise.resolve(locResult as unknown as Promise<{ start?: { href?: string } }> | { start?: { href?: string } }).then(handleLocObj).catch((err: Error) => {
        console.error('[EPUBReader] currentLocation() failed:', err)
      })
    }

    // Apply pending highlight after navigation completes
    if (pendingHighlightRef.current) {
      const searchText = pendingHighlightRef.current
      pendingHighlightRef.current = null

      const rendition = renditionRef.current
      const book = (rendition as unknown as { book?: Book }).book
      if (!book || typeof (book as unknown as { find?: (text: string) => Promise<Array<{ cfi: string; excerpt: string }>> }).find !== 'function') {
        return
      }

      // Delay slightly to ensure chapter content is loaded
      setTimeout(async () => {
        try {
          // Clear previous highlight annotation
          if (highlightAnnotationRef.current && rendition) {
            try {
              rendition.annotations.remove('highlight', highlightAnnotationRef.current)
            } catch {
              // ignore removal errors
            }
            highlightAnnotationRef.current = null
          }

          const trimmed = searchText.trim()
          if (!trimmed) return

          let results: Array<{ cfi: string; excerpt: string }> = []
          results = await (book as unknown as { find: (text: string) => Promise<Array<{ cfi: string; excerpt: string }>> }).find(trimmed)

          // Fallback: search for first 60 chars
          if (results.length === 0 && trimmed.length > 60) {
            const fallback = trimmed.slice(0, 60).trim()
            if (fallback.length >= 10) {
              results = await (book as unknown as { find: (text: string) => Promise<Array<{ cfi: string; excerpt: string }>> }).find(fallback)
            }
          }

          if (results.length === 0 || !rendition) return

          const result = results[0]
          const cfi = result.cfi

          rendition.annotations.add(
            'highlight',
            cfi,
            {},
            () => {},
            'reader-highlight',
            {
              fill: 'rgba(255, 215, 0, 0.4)',
              'fill-opacity': '0.4',
            }
          )
          highlightAnnotationRef.current = cfi
        } catch (err) {
          console.error('Failed to highlight text in EPUB:', err)
        }
      }, 200)
    }
  }, [])

  // Get rendition when ready
  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition
    setIsRenditionReady(true)

    // Inject CSS to apply Apple light theme and highlight styles
    rendition.hooks.content.register((contents: Contents) => {
      contents.addStylesheetCss(`
        body, html {
          overflow-x: hidden !important;
          background: #FFFFFF !important;
          color: #1E293B !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          line-height: 1.6 !important;
        }
        body * {
          background-color: transparent !important;
        }
        a {
          color: #007AFF !important;
        }
        .reader-highlight {
          background-color: rgba(255, 215, 0, 0.4) !important;
          border-radius: 2px !important;
        }
      `, 'apple-theme-fix')

      // Forward wheel and touch events to the outer scrollable container
      // because iframe events do not bubble across document boundaries.
      const doc = contents.document

      const handleWheel = (e: Event) => {
        const wheelEvent = e as WheelEvent
        const scrollable = scrollContainerRef.current
        if (!scrollable) return
        wheelEvent.preventDefault()
        scrollable.scrollTop += wheelEvent.deltaY
      }

      // Touch handling for mobile drag-scrolling
      let touchStartY = 0
      const handleTouchStart = (e: Event) => {
        const touchEvent = e as TouchEvent
        touchStartY = touchEvent.touches[0].clientY
      }
      const handleTouchMove = (e: Event) => {
        const touchEvent = e as TouchEvent
        const scrollable = scrollContainerRef.current
        if (!scrollable) return
        const deltaY = touchStartY - touchEvent.touches[0].clientY
        touchStartY = touchEvent.touches[0].clientY
        touchEvent.preventDefault()
        scrollable.scrollTop += deltaY
      }

      doc.addEventListener('wheel', handleWheel, { passive: false })
      doc.addEventListener('touchstart', handleTouchStart, { passive: true })
      doc.addEventListener('touchmove', handleTouchMove, { passive: false })

      // Store cleanup function for this content document
      const cleanup = () => {
        doc.removeEventListener('wheel', handleWheel)
        doc.removeEventListener('touchstart', handleTouchStart)
        doc.removeEventListener('touchmove', handleTouchMove)
      }
      eventCleanupRef.current.push(cleanup)
    })

    // Extract TOC from book
    const book = (rendition as unknown as { book?: Book }).book
    if (book) {
      book.loaded.navigation.then((navigation) => {
        const toc: Chapter[] = []
        const flattenToc = (items: typeof navigation.toc, depth = 0) => {
          for (const item of items) {
            toc.push({
              id: item.id,
              href: item.href,
              label: item.label,
              depth,
            })
            if (item.subitems && item.subitems.length > 0) {
              flattenToc(item.subitems as typeof navigation.toc, depth + 1)
            }
          }
        }
        flattenToc(navigation.toc)
        tocRef.current = toc
        setChapters(toc)

        // Set initial chapter name
        if (toc.length > 0) {
          setCurrentChapter(toc[0].label)
          setCurrentChapterHref(toc[0].href)
        }

        setIsLoading(false)
      }).catch((err: Error) => {
        console.error('Failed to load navigation:', err)
        setIsLoading(false)
      })
    }
  }, [])

  // Unified navigation effect: all prop-driven navigation goes through setLocation
  // so react-reader's componentDidUpdate handles the single rendition.display() call
  useEffect(() => {
    if (!isRenditionReady) return

    // Priority: highlightAnchor (CFI) > chapterHref > pageNumber
    if (highlightAnchor) {
      setLocation(highlightAnchor)
    } else if (chapterHref) {
      setLocation(chapterHref)
      // Queue highlight for after navigation completes
      if (highlightText) {
        pendingHighlightRef.current = highlightText
      }
    } else if (pageNumber && pageNumber > 0) {
      const percentage = totalPagesProp && totalPagesProp > 0
        ? (pageNumber - 1) / totalPagesProp
        : (pageNumber - 1) / 100
      setLocation(Math.max(0, Math.min(0.999, percentage)))
    }
  }, [highlightAnchor, chapterHref, pageNumber, totalPagesProp, isRenditionReady, highlightText])

  // Chapter navigation helpers
  const currentChapterIndex = chapters.findIndex((c) => c.href === currentChapterHref)
  const isFirstChapter = currentChapterIndex <= 0
  const isLastChapter = currentChapterIndex >= chapters.length - 1

  const goToChapter = useCallback((index: number) => {
    if (index < 0 || index >= chapters.length) return
    const chapter = chapters[index]
    if (!chapter) return
    // Navigate via setLocation so react-reader handles the single rendition.display() call
    setLocation(chapter.href)
  }, [chapters])

  const goToPrevChapter = useCallback(() => {
    if (isFirstChapter) return
    goToChapter(currentChapterIndex - 1)
  }, [goToChapter, currentChapterIndex, isFirstChapter])

  const goToNextChapter = useCallback(() => {
    if (isLastChapter) return
    goToChapter(currentChapterIndex + 1)
  }, [goToChapter, currentChapterIndex, isLastChapter])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable element
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToPrevChapter()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToNextChapter()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToPrevChapter, goToNextChapter])

  // Cleanup event listeners registered on iframe documents
  useEffect(() => {
    return () => {
      eventCleanupRef.current.forEach((cleanup) => cleanup())
      eventCleanupRef.current = []
    }
  }, [])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current chapter - fixed at top */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 bg-slate-50 flex-shrink-0">
        {/* TOC toggle button — prominent, with text */}
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

        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-medium text-gray-700 truncate">
            {isLoading ? 'Loading...' : currentChapter}
          </p>
          {chapters.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {currentChapterIndex + 1} / {chapters.length} chapters
            </p>
          )}
        </div>

        {/* Spacer to balance layout */}
        <div className="w-[72px] flex-shrink-0" />
      </div>

      {/* Main content: TOC sidebar + reader */}
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
              {chapters.map((chapter, index) => {
                const isActive = chapter.label === currentChapter
                return (
                  <button
                    key={chapter.id + '-' + index}
                    onClick={() => {
                      goToChapter(index)
                      setTocOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm font-sans transition-colors flex items-center gap-1',
                      isActive
                        ? 'bg-apple-blue/10 text-apple-blue font-medium'
                        : 'text-gray-700 hover:bg-slate-50'
                    )}
                    style={{ paddingLeft: `${16 + chapter.depth * 16}px` }}
                  >
                    {chapter.depth > 0 && (
                      <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="truncate">{chapter.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* EPUB Viewer */}
        <div className="flex-1 min-h-0 relative bg-white flex flex-col" style={{ overflow: 'hidden' }}>
          <div ref={scrollContainerRef} className="flex-1 absolute inset-0 overflow-auto bg-white">
            <ReactReader
              url={bookUrl}
              location={location}
              locationChanged={locationChanged}
              getRendition={getRendition}
              readerStyles={readerStyles}
              epubViewStyles={{
                viewHolder: {
                  position: "relative",
                  height: "100%",
                  width: "100%",
                },
                view: {
                  height: "100%",
                }
              }}
              epubOptions={{
                flow: 'scrolled',
                manager: 'continuous',
                spread: 'none',
              }}
              epubInitOptions={{
                openAs: 'epub',
              }}
              loadingView={
                <div className="flex items-center justify-center h-full bg-white">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-apple-blue" />
                  <span className="ml-3 text-gray-500 font-sans">Loading EPUB...</span>
                </div>
              }
            />
          </div>

          {/* Bottom navigation */}
          {chapters.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
              <button
                onClick={goToPrevChapter}
                disabled={isFirstChapter}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white shadow-sm text-sm font-sans transition-colors',
                  isFirstChapter
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-slate-50'
                )}
                aria-label="Previous chapter"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
              <button
                onClick={goToNextChapter}
                disabled={isLastChapter}
                className={cn(
                  'flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white shadow-sm text-sm font-sans transition-colors',
                  isLastChapter
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-slate-50'
                )}
                aria-label="Next chapter"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
