import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react'
import ePub, { Book, Rendition, Location } from 'epubjs'

interface EPUBReaderProps {
  bookId: string
  className?: string
  highlightAnchor?: string | null
  /** External page number to navigate to (approximate for EPUB based on percentage) */
  pageNumber?: number
  /** Total pages for calculating percentage position in EPUB */
  totalPages?: number
}

interface Chapter {
  id: string
  href: string
  title: string
  index: number
}

export function EPUBReader({
  bookId,
  className,
  highlightAnchor,
  pageNumber,
  totalPages: totalPagesProp,
}: EPUBReaderProps) {
  const [book, setBook] = useState<Book | null>(null)
  const [rendition, setRendition] = useState<Rendition | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentChapter, setCurrentChapter] = useState<string>('Unknown')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)

  // Load EPUB document
  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    setIsLoading(true)
    setError(null)

    const loadEpub = async () => {
      try {
        // Fetch the EPUB file as ArrayBuffer - pass directly to epubjs
        // This avoids the blob URL issue where relative URLs can't be resolved
        const response = await fetch(`/api/books/${bookId}/file`)
        if (!response.ok) {
          throw new Error(`Failed to fetch EPUB: ${response.status}`)
        }
        const arrayBuffer = await response.arrayBuffer()

        if (cancelled) return

        // Create EPUB from ArrayBuffer - epubjs handles internal resource resolution internally
        const epubBook = ePub(arrayBuffer)
        bookRef.current = epubBook

        // Add timeout to prevent hanging
        const readyPromise = epubBook.ready
        timeoutId = setTimeout(() => {
          if (!cancelled) {
            epubBook.destroy()
            setError('EPUB loading timed out - the file may be corrupted')
            setIsLoading(false)
          }
        }, 30000) // 30 second timeout

        await readyPromise
        clearTimeout(timeoutId)

        if (cancelled) {
          epubBook.destroy()
          return
        }

        // Get navigation (table of contents)
        const navigation = await epubBook.loaded.navigation
        const toc = navigation.toc

        const chapterList: Chapter[] = []
        let index = 0
        const flattenToc = (items: typeof toc) => {
          for (const item of items) {
            chapterList.push({
              id: item.id,
              href: item.href,
              title: item.label,
              index: index++,
            })
            if (item.subitems && item.subitems.length > 0) {
              flattenToc(item.subitems as typeof toc)
            }
          }
        }
        flattenToc(toc)
        setChapters(chapterList)

        setBook(epubBook)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load EPUB')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
        if (timeoutId) clearTimeout(timeoutId)
      }
    }

    loadEpub()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      bookRef.current?.destroy()
    }
  }, [bookId])

  // Initialize rendition
  useEffect(() => {
    if (!book || !viewerRef.current) return

    const rend = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'auto',
    })

    // Display the book - must await to prevent cleanup destroying rendition mid-display
    rend.display().catch((err) => {
      console.log('EPUB display error:', err)
    })

    setRendition(rend)

    // Handle location changes
    const handleLocationChanged = (location: Location) => {
      // Update current chapter
      if (location.start && location.start.href) {
        const currentHref = location.start.href.split('#')[0]
        const chapter = chapters.find((c) => c.href.startsWith(currentHref))
        if (chapter) {
          setCurrentChapter(chapter.title)
        }

        // Update prev/next availability
        setCanPrev(location.start.index > 0)
        setCanNext(location.start.index < chapters.length - 1)
      }
    }

    rend.on('locationChanged', handleLocationChanged)

    return () => {
      rend.off('locationChanged', handleLocationChanged)
      rend.destroy()
    }
  }, [book, chapters])

  // Highlight handling
  useEffect(() => {
    if (rendition && highlightAnchor) {
      // highlightAnchor can be a CFI or element id
      try {
        rendition.display(highlightAnchor)
      } catch (err) {
        console.log('Could not navigate to highlight:', highlightAnchor)
      }
    }
  }, [rendition, highlightAnchor])

  // Handle external page number navigation (approximate for EPUB)
  useEffect(() => {
    if (rendition && pageNumber && pageNumber > 0) {
      // For EPUB, we use percentage-based navigation since EPUB doesn't have fixed pages
      // If totalPages is provided, calculate percentage; otherwise assume pageNumber is percentage
      const percentage = totalPagesProp && totalPagesProp > 0
        ? (pageNumber - 1) / totalPagesProp
        : (pageNumber - 1) / 100

      const percentageClamped = Math.max(0, Math.min(0.999, percentage))

      try {
        // Navigate to the calculated percentage location
        rendition.display(percentageClamped)
      } catch (err) {
        console.log('Could not navigate to page:', pageNumber)
      }
    }
  }, [rendition, pageNumber, totalPagesProp])

  const goToPrevious = useCallback(() => {
    if (rendition && canPrev) {
      rendition.prev()
    }
  }, [rendition, canPrev])

  const goToNext = useCallback(() => {
    if (rendition && canNext) {
      rendition.next()
    }
  }, [rendition, canNext])

  const goToChapter = useCallback((chapter: Chapter) => {
    if (rendition) {
      rendition.display(chapter.href)
    }
  }, [rendition])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        goToPrevious()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToPrevious, goToNext])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="ml-3 text-muted-foreground">Loading EPUB...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-destructive', className)}>
        <BookOpen className="h-12 w-12 opacity-50" />
        <p className="mt-4">Failed to load EPUB</p>
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  // Show loading or error states before book is loaded
  if (!book) {
    if (isLoading) {
      return (
        <div className={cn('flex items-center justify-center py-12', className)}>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="ml-3 text-muted-foreground">Loading EPUB...</span>
        </div>
      )
    }
    if (error) {
      return (
        <div className={cn('flex flex-col items-center justify-center py-12 text-destructive', className)}>
          <BookOpen className="h-12 w-12 opacity-50" />
          <p className="mt-4">Failed to load EPUB</p>
          <p className="text-sm">{error}</p>
        </div>
      )
    }
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-muted-foreground', className)}>
        <BookOpen className="h-12 w-12 opacity-50" />
        <p className="mt-4">No EPUB document</p>
      </div>
    )
  }

  // Book is loaded - render the viewer div so effect can initialize rendition
  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between gap-4 p-3 border-b bg-muted/50">
        <button
          onClick={goToPrevious}
          disabled={!canPrev}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            'bg-background border hover:bg-muted',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-medium truncate">{currentChapter}</p>
          {chapters.length > 0 && (
            <select
              value={chapters.find((c) => c.title === currentChapter)?.index ?? -1}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10)
                const chapter = chapters[idx]
                if (chapter) goToChapter(chapter)
              }}
              className={cn(
                'mt-1 w-full max-w-xs mx-auto text-sm rounded-md border bg-background px-2 py-1',
                'focus:outline-none focus:ring-2 focus:ring-primary'
              )}
            >
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.index}>
                  {chapter.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={goToNext}
          disabled={!canNext}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            'bg-background border hover:bg-muted',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Show spinner inside viewer until rendition is initialized */}
      <div
        ref={viewerRef}
        className="flex-1 overflow-hidden relative"
      >
        {!rendition && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}
