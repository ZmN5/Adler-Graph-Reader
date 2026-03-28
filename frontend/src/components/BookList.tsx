import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { listBooks, deleteBook, extractBook, BookSummary } from '@/lib/api-client'
import { Book, Trash2, Sparkles, FileText, BookOpen, CheckCircle } from 'lucide-react'

interface BookListProps {
  className?: string
  onSelectBook?: (book: BookSummary) => void
  onUploadSuccess?: () => void
  onExtractionComplete?: (bookId: string, nodesCount: number, edgesCount: number) => void
}

interface ExtractionResult {
  bookId: string
  nodesCount: number
  edgesCount: number
}

export function BookList({ className, onSelectBook, onUploadSuccess, onExtractionComplete }: BookListProps) {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extractingBookId, setExtractingBookId] = useState<string | null>(null)
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null)

  const loadBooks = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await listBooks()
      setBooks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load books')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBooks()
  }, [loadBooks, onUploadSuccess])

  const handleDelete = useCallback(async (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this book?')) {
      return
    }
    try {
      await deleteBook(bookId)
      setBooks((prev) => prev.filter((b) => b.id !== bookId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete book')
    }
  }, [])

  const handleExtract = useCallback(async (e: React.MouseEvent, book: BookSummary) => {
    e.stopPropagation()
    setExtractingBookId(book.id)
    setExtractionResult(null)
    try {
      const result = await extractBook(book.id)
      const extractionRes: ExtractionResult = {
        bookId: book.id,
        nodesCount: result.nodes_count,
        edgesCount: result.edges_count,
      }
      setExtractionResult(extractionRes)
      onExtractionComplete?.(book.id, result.nodes_count, result.edges_count)
      await loadBooks()

      // Auto-clear result after 5 seconds
      setTimeout(() => {
        setExtractionResult((prev) =>
          prev?.bookId === book.id ? null : prev
        )
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract concepts')
    } finally {
      setExtractingBookId(null)
    }
  }, [loadBooks, onExtractionComplete])

  const formatBadge = (format: string) => {
    const isPdf = format.toLowerCase() === 'pdf'
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          isPdf ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        )}
      >
        {isPdf ? <FileText className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
        {format.toUpperCase()}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('text-center text-destructive', className)}>
        <p>{error}</p>
        <button onClick={loadBooks} className="mt-2 text-sm underline">
          Try again
        </button>
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div className={cn('text-center text-muted-foreground py-12', className)}>
        <Book className="mx-auto h-12 w-12 opacity-50" />
        <p className="mt-4">No books yet</p>
        <p className="text-sm">Upload a book to get started</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {books.map((book) => (
        <div
          key={book.id}
          onClick={() => onSelectBook?.(book)}
          className="group flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 cursor-pointer"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Book className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{book.title}</h3>
              {formatBadge(book.format)}
              {extractionResult?.bookId === book.id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <CheckCircle className="h-3 w-3" />
                  {extractionResult.nodesCount} nodes, {extractionResult.edgesCount} edges
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              {book.author && <span>{book.author}</span>}
              {book.total_pages && <span>{book.total_pages} pages</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => handleExtract(e, book)}
              disabled={extractingBookId === book.id}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50'
              )}
              title="Extract concepts"
            >
              {extractingBookId === book.id ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Extract
            </button>
            <button
              onClick={(e) => handleDelete(e, book.id)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors bg-destructive/10 text-destructive hover:bg-destructive/20"
              title="Delete book"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}