import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ReactReader } from 'react-reader'
import type { Rendition, Book, Contents } from 'epubjs'
import type { IReactReaderStyle } from 'react-reader'

interface EPUBReaderProps {
  bookId: string
  className?: string
  highlightAnchor?: string | null
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
  pageNumber,
  totalPages: totalPagesProp,
  chapterHref,
}: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0)
  const [currentChapter, setCurrentChapter] = useState<string>('Unknown')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const renditionRef = useRef<Rendition | null>(null)
  const tocRef = useRef<Chapter[]>([])

  const bookUrl = `/api/books/${bookId}/file`

  // Handle location changes
  const locationChanged = useCallback((epubcfi: string) => {
    setLocation(epubcfi)

    // Update current chapter based on location
    if (renditionRef.current && tocRef.current.length > 0) {
      // Get current location from rendition
      const locationObj = renditionRef.current.currentLocation() as unknown as {
        start?: { href?: string; cfi?: string }
        end?: { href?: string; cfi?: string }
      } | null

      if (locationObj && locationObj.start && locationObj.start.href) {
        const currentHref = locationObj.start.href
        const chapter = tocRef.current.find((c) => currentHref.includes(c.href))
        if (chapter) {
          setCurrentChapter(chapter.label)
        }
      }
    }
  }, [])

  // Get rendition when ready
  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition

    // Inject CSS to fix scrolling in scrolled mode
    rendition.hooks.content.register((contents: Contents) => {
      contents.addStylesheetCss(`
        body, html {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          height: auto !important;
        }
      `, 'scroll-fix')
    })

    // Extract TOC from book
    const book = (rendition as unknown as { book?: Book }).book
    if (book) {
      book.loaded.navigation.then((navigation) => {
        const toc: Chapter[] = []
        const flattenToc = (items: typeof navigation.toc) => {
          for (const item of items) {
            toc.push({
              id: item.id,
              href: item.href,
              label: item.label,
            })
            if (item.subitems && item.subitems.length > 0) {
              flattenToc(item.subitems as typeof navigation.toc)
            }
          }
        }
        flattenToc(navigation.toc)
        tocRef.current = toc
        setChapters(toc)

        // Set initial chapter name
        if (toc.length > 0) {
          setCurrentChapter(toc[0].label)
        }

        setIsLoading(false)
      }).catch((err: Error) => {
        console.error('Failed to load navigation:', err)
        setIsLoading(false)
      })
    }
  }, [])

  // Handle highlight/chapter navigation from props
  useEffect(() => {
    if (!renditionRef.current) return

    // Priority: highlightAnchor (CFI) > chapterHref > pageNumber
    if (highlightAnchor) {
      // If it's a CFI, use it directly
      if (highlightAnchor.includes('epubcfi')) {
        setLocation(highlightAnchor)
      } else {
        // It's a chapter href
        setLocation(highlightAnchor)
      }
    } else if (chapterHref) {
      setLocation(chapterHref)
    } else if (pageNumber && pageNumber > 0) {
      // Convert page number to percentage for EPUB
      const percentage = totalPagesProp && totalPagesProp > 0
        ? (pageNumber - 1) / totalPagesProp
        : (pageNumber - 1) / 100
      setLocation(Math.max(0, Math.min(0.999, percentage)))
    }
  }, [highlightAnchor, chapterHref, pageNumber, totalPagesProp])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current chapter - fixed at top */}
      <div className="flex items-center justify-center p-3 border-b bg-muted/50 flex-shrink-0">
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-medium truncate">
            {isLoading ? 'Loading...' : currentChapter}
          </p>
          {chapters.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {chapters.findIndex((c) => c.label === currentChapter) + 1} / {chapters.length} chapters
            </p>
          )}
        </div>
      </div>

      {/* EPUB Viewer */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div style={{ height: "100%", overflow: "auto" }}>
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
                overflow: "auto",
              },
              view: {
                height: "100%",
                overflow: "visible",
              }
            }}
            epubOptions={{
              flow: 'scrolled',
              manager: 'continuous',
              spread: 'none',
            }}
            pageTurnOnScroll={false}
            epubInitOptions={{
              openAs: 'epub',
            }}
            loadingView={
              <div className="flex items-center justify-center h-full">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <span className="ml-3 text-muted-foreground">Loading EPUB...</span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  )
}
