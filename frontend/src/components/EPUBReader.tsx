import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, BookOpen, ChevronDown } from 'lucide-react'
import ePub, { Book, Rendition, Location } from 'epubjs'

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
  title: string
  index: number
}

export function EPUBReader({
  bookId,
  className,
  highlightAnchor,
  pageNumber,
  totalPages: totalPagesProp,
  chapterHref,
}: EPUBReaderProps) {
  const [book, setBook] = useState<Book | null>(null)
  const [rendition, setRendition] = useState<Rendition | null>(null)
  const [isRendering, setIsRendering] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentChapter, setCurrentChapter] = useState<string>('Unknown')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
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

    setIsRendering(true)

    const rend = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'auto',
      allowScriptedContent: true,
    })

    // Display the book - must await to prevent cleanup destroying rendition mid-display
    rend.display()
      .then(() => {
        setIsRendering(false)
      })
      .catch((err) => {
        console.error('EPUB display error:', err)
        setIsRendering(false)
        setError(err instanceof Error ? err.message : 'Failed to display EPUB')
      })

    setRendition(rend)

    // Handle location changes
    const handleLocationChanged = (location: Location) => {
      // Update current chapter
      if (location.start && location.start.href) {
        const currentHref = location.start.href.split('#')[0]
        // Match by href - currentHref is full URL, chapter.href is relative
        // Use endsWith since the relative href is appended to the base URL
        const foundIndex = chapters.findIndex((c) => currentHref.endsWith(c.href))
        if (foundIndex !== -1) {
          const chapter = chapters[foundIndex]
          setCurrentChapter(chapter.title)
          setCurrentChapterIndex(foundIndex)
          // Update prev/next availability based on flattened chapter list
          setCanPrev(foundIndex > 0)
          setCanNext(foundIndex < chapters.length - 1)
        }
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
    if (rendition && highlightAnchor && book) {
      // Validate: ensure book spine is loaded and highlightAnchor is not empty
      const isValidTarget = highlightAnchor &&
        typeof highlightAnchor === 'string' &&
        highlightAnchor.trim().length > 0

      if (!isValidTarget) return

      // Check if it's a CFI string
      const isCfi = highlightAnchor.includes('epubcfi')

      try {
        if (isCfi) {
          // For CFI, check if the spine can resolve it
          rendition.display(highlightAnchor)
        } else {
          // For element ID or href, try display directly
          rendition.display(highlightAnchor)
        }
      } catch (err) {
        console.log('Could not navigate to highlight:', highlightAnchor, err)
      }
    }
  }, [rendition, highlightAnchor, book])

  // Handle external page number navigation (approximate for EPUB)
  useEffect(() => {
    if (rendition && pageNumber && pageNumber > 0 && book) {
      // For EPUB, we use percentage-based navigation since EPUB doesn't have fixed pages
      // If totalPages is provided, calculate percentage; otherwise assume pageNumber is percentage
      const percentage = totalPagesProp && totalPagesProp > 0
        ? (pageNumber - 1) / totalPagesProp
        : (pageNumber - 1) / 100

      const percentageClamped = Math.max(0, Math.min(0.999, percentage))

      // Only use percentage-based navigation if book locations are loaded
      // Otherwise fall back to displaying the first section
      try {
        if (book.locations && book.locations.length && book.locations.length() > 0) {
          // Navigate to the calculated percentage location
          rendition.display(percentageClamped)
        } else {
          // Fall back to initial display if locations not yet available
          rendition.display()
        }
      } catch (err) {
        console.log('Could not navigate to page:', pageNumber)
      }
    }
  }, [rendition, pageNumber, totalPagesProp, book])

  // Handle chapter href navigation (for Source Citations)
  useEffect(() => {
    if (rendition && chapterHref && chapters.length > 0) {
      // chapterHref is the direct href from the chunk (e.g., "chapter-1.html")
      try {
        rendition.display(chapterHref)
      } catch (err) {
        console.log('Could not navigate to chapter href:', chapterHref, err)
      }
    }
  }, [rendition, chapterHref, chapters])

  const goToPrevious = useCallback(() => {
    if (rendition && canPrev && currentChapterIndex > 0) {
      const prevChapter = chapters[currentChapterIndex - 1]
      if (prevChapter) {
        rendition.display(prevChapter.href)
      }
    }
  }, [rendition, canPrev, currentChapterIndex, chapters])

  const goToNext = useCallback(() => {
    if (rendition && canNext && currentChapterIndex < chapters.length - 1) {
      const nextChapter = chapters[currentChapterIndex + 1]
      if (nextChapter) {
        rendition.display(nextChapter.href)
      }
    }
  }, [rendition, canNext, currentChapterIndex, chapters])

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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

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
            <div ref={dropdownRef} className="relative mt-1 mx-auto max-w-xs">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 text-sm rounded-md border bg-background px-3 py-1.5',
                  'focus:outline-none focus:ring-2 focus:ring-primary transition-colors',
                  'hover:bg-muted'
                )}
              >
                <span className="truncate">
                  {chapters.find((c) => c.title === currentChapter)?.title ?? 'Select chapter'}
                </span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 flex-shrink-0 transition-transform duration-200',
                    isDropdownOpen && 'rotate-180'
                  )}
                />
              </button>
              {isDropdownOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      type="button"
                      onClick={() => {
                        goToChapter(chapter)
                        setIsDropdownOpen(false)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm transition-colors',
                        'hover:bg-muted',
                        chapter.title === currentChapter && 'bg-muted font-medium'
                      )}
                    >
                      {chapter.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
        className="flex-1 min-h-0 overflow-hidden relative"
      >
        {(isRendering || !rendition) && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}
