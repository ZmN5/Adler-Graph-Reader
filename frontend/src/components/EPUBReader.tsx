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
  const [isRenditionReady, setIsRenditionReady] = useState(false)

  const bookUrl = `/api/books/${bookId}/file`

  // Handle location changes
  const locationChanged = useCallback((loc: string) => {

    const rendition = renditionRef.current
    if (!rendition) return

    // For href navigation (from TOC), we need to handle it ourselves because
    // react-reader's componentDidUpdate might not work correctly with href strings
    if (!loc.includes('epubcfi') && !loc.includes('epubcfi(')) {

      // For href navigation (from TOC), use rendition.display() directly
      // Then the CFI-based locationChanged will fire and we can update state from that
      rendition.display(loc).then(() => {
      }).catch((err) => {
        console.error('[EPUBReader] display(href) failed:', err)
      })
      // Update location state immediately - don't wait for display() to complete
      setLocation(loc)
      // Also find and set the current chapter label right away
      const chapter = tocRef.current.find((c) =>
        loc.toLowerCase().includes(c.href.toLowerCase()) ||
        c.href.toLowerCase().includes(loc.toLowerCase())
      )
      if (chapter) {
        setCurrentChapter(chapter.label)
      }
      return
    }

    // For CFI navigation, just update the location state
    setLocation(loc)

    // Update current chapter based on location
    if (tocRef.current.length > 0) {
      const locResult = rendition.currentLocation()
      const handleLocObj = (result: any) => {
        const currentHref = result?.start?.href
        if (currentHref) {
          const chapter = tocRef.current.find((c) =>
            currentHref.toLowerCase().includes(c.href.toLowerCase()) ||
            c.href.toLowerCase().includes(currentHref.toLowerCase())
          )
          if (chapter) {
            setCurrentChapter(chapter.label)
          } else {
          }
        }
      }
      if ((locResult as unknown as { then?: Function }).then) {
        (locResult as unknown as Promise<any>).then(handleLocObj).catch((err: Error) => {
          console.error('[EPUBReader] currentLocation() failed:', err)
        })
      } else {
        handleLocObj(locResult as unknown as { start?: { href?: string } })
      }
    }
  }, [])

  // Get rendition when ready
  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition
    setIsRenditionReady(true)

    // Inject CSS to fix scrolling and apply Apple light theme
    rendition.hooks.content.register((contents: Contents) => {
      contents.addStylesheetCss(`
        body, html {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          height: auto !important;
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
      `, 'apple-theme-fix')
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
    if (!renditionRef.current || !isRenditionReady) {
      return
    }

    const rendition = renditionRef.current

    // Priority: highlightAnchor (CFI) > chapterHref > pageNumber
    if (highlightAnchor) {
      if (highlightAnchor.includes('epubcfi')) {
        rendition.display(highlightAnchor).then(() => setLocation(highlightAnchor)).catch(console.error)
      } else {
        // It's a chapter href - use spine.get() to find correct spine item
        const book = (rendition as unknown as { book?: Book }).book
        if (book && book.spine) {
          const spineItem = book.spine.get(highlightAnchor)
          if (spineItem) {
            rendition.display(spineItem.index).then(() => setLocation(highlightAnchor)).catch(console.error)
          } else {
            rendition.display(highlightAnchor).then(() => setLocation(highlightAnchor)).catch(console.error)
          }
        } else {
          rendition.display(highlightAnchor).then(() => setLocation(highlightAnchor)).catch(console.error)
        }
      }
    } else if (chapterHref) {

      // Use spine.get() to find correct spine item
      const book = (rendition as unknown as { book?: Book }).book
      if (book && book.spine) {
        const spineItem = book.spine.get(chapterHref)
        if (spineItem) {
          rendition.display(spineItem.index).then(() => {
            setLocation(chapterHref)
            // Immediately update currentChapter from tocRef - don't rely on currentLocation()
            // which can return nav.xhtml instead of the actual chapter
            const chapter = tocRef.current.find((c) => c.href === chapterHref)
            if (chapter) {
              setCurrentChapter(chapter.label)
            }
          }).catch(console.error)
        } else {
          rendition.display(chapterHref).then(() => {
            setLocation(chapterHref)
            const chapter = tocRef.current.find((c) => c.href === chapterHref)
            if (chapter) {
              setCurrentChapter(chapter.label)
            }
          }).catch(console.error)
        }
      } else {
        rendition.display(chapterHref).then(() => setLocation(chapterHref)).catch(console.error)
      }
    } else if (pageNumber && pageNumber > 0) {
      // Convert page number to percentage for EPUB
      const percentage = totalPagesProp && totalPagesProp > 0
        ? (pageNumber - 1) / totalPagesProp
        : (pageNumber - 1) / 100
      rendition.display(Math.max(0, Math.min(0.999, percentage))).catch(console.error)
    }
  }, [highlightAnchor, chapterHref, pageNumber, totalPagesProp, isRenditionReady])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header showing current chapter - fixed at top */}
      <div className="flex items-center justify-center p-3 border-b border-gray-200 bg-slate-50 flex-shrink-0">
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-medium text-gray-700 truncate">
            {isLoading ? 'Loading...' : currentChapter}
          </p>
          {chapters.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {chapters.findIndex((c) => c.label === currentChapter) + 1} / {chapters.length} chapters
            </p>
          )}
        </div>
      </div>

      {/* EPUB Viewer */}
      <div className="flex-1 min-h-0 relative bg-white" style={{ overflow: 'hidden' }}>
        <div className="absolute inset-0 overflow-auto bg-white">
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
              <div className="flex items-center justify-center h-full bg-white">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-apple-blue" />
                <span className="ml-3 text-gray-500 font-sans">Loading EPUB...</span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  )
}
