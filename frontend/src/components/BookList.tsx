import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { listBooks, deleteBook, extractBook, parseBook, BookSummary } from '@/lib/api-client'
import { Book, Trash2, Sparkles, FileText, BookOpen, CheckCircle, PlayCircle } from 'lucide-react'
import { ConfirmDialog } from './ConfirmDialog'

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
  const [parsingBookId, setParsingBookId] = useState<string | null>(null)
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null)
  const [extractionError, setExtractionError] = useState<{ bookId: string; message: string } | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [bookToDelete, setBookToDelete] = useState<{ id: string; name: string } | null>(null)

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

  const handleDelete = useCallback((e: React.MouseEvent, bookId: string, bookName: string) => {
    e.stopPropagation()
    setBookToDelete({ id: bookId, name: bookName })
    setIsDeleteModalOpen(true)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!bookToDelete) return
    try {
      await deleteBook(bookToDelete.id)
      setBooks((prev) => prev.filter((b) => b.id !== bookToDelete.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete book')
    }
  }, [bookToDelete])

  const handleExtract = useCallback(async (e: React.MouseEvent, book: BookSummary) => {
    e.stopPropagation()
    setExtractingBookId(book.id)
    setExtractionResult(null)
    setExtractionError(null)
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
      setExtractionError({ bookId: book.id, message: err instanceof Error ? err.message : 'Failed to extract concepts' })
    } finally {
      setExtractingBookId(null)
    }
  }, [loadBooks, onExtractionComplete])

  const handleParse = useCallback(async (e: React.MouseEvent, book: BookSummary) => {
    e.stopPropagation()
    setParsingBookId(book.id)
    try {
      await parseBook(book.id)
      await loadBooks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse book')
    } finally {
      setParsingBookId(null)
    }
  }, [loadBooks])

  const formatBadge = (format: string) => {
    const isPdf = format.toLowerCase() === 'pdf'
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium font-sans',
          isPdf
            ? 'bg-red-50 text-red-600 border border-red-200'
            : 'bg-blue-50 text-blue-600 border border-blue-200'
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
        <div className="h-8 w-8 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
        <span className="ml-3 text-gray-500 font-sans">Loading library...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('text-center text-red-500 py-8 font-sans', className)}>
        <p>{error}</p>
        <button onClick={loadBooks} className="mt-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          Try again
        </button>
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div className={cn('text-center text-gray-500 py-12', className)}>
        <div className="relative inline-block">
          <Book className="mx-auto h-14 w-14 text-gray-300" />
        </div>
        <p className="mt-4 text-gray-600 font-sans">No books in your library</p>
        <p className="text-sm text-gray-400 mt-1 font-sans">Upload a book to begin your journey</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {books.map((book) => (
        <div
          key={book.id}
          onClick={() => onSelectBook?.(book)}
          className={cn(
            'group flex items-center gap-4 rounded-xl border bg-white p-4 transition-all cursor-pointer',
            'hover:border-gray-300 hover:shadow-apple-md hover:bg-slate-50',
            'border-gray-200'
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 border border-gray-200">
            <Book className="h-6 w-6 text-gray-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-sans font-semibold text-gray-900 truncate">{book.title}</h3>
              {formatBadge(book.format)}
              {extractingBookId === book.id && (
                <span className="inline-flex items-center gap-1 text-xs text-apple-purple font-sans">
                  <div className="h-3 w-3 border border-apple-purple/30 border-t-apple-purple rounded-full animate-spin" />
                  Extracting...
                </span>
              )}
              {extractionResult?.bookId === book.id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600 border border-green-200 font-sans">
                  <CheckCircle className="h-3 w-3" />
                  {extractionResult.nodesCount} nodes, {extractionResult.edgesCount} edges
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 font-sans">
              {book.author && <span>{book.author}</span>}
              {book.total_pages && <span>{book.total_pages} pages</span>}
              {!book.total_pages && (
                <span className="text-amber-600 text-xs">Not parsed yet</span>
              )}
            </div>
            {extractionError?.bookId === book.id && (
              <p className="mt-1 text-xs text-red-500 font-sans">{extractionError.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {book.total_pages == null ? (
              <button
                onClick={(e) => handleParse(e, book)}
                disabled={parsingBookId === book.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-sans font-medium transition-all',
                  'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 hover:border-blue-300',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                title="Parse book to extract concepts"
              >
                {parsingBookId === book.id ? (
                  <div className="h-4 w-4 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Parse
              </button>
            ) : (
              <button
                onClick={(e) => handleExtract(e, book)}
                disabled={extractingBookId === book.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-sans font-medium transition-all',
                  'bg-purple-50 border border-purple-200 text-purple-600 hover:bg-purple-100 hover:border-purple-300',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                title="Extract concepts"
              >
                {extractingBookId === book.id ? (
                  <div className="h-4 w-4 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Extract
              </button>
            )}
            <button
              onClick={(e) => handleDelete(e, book.id, book.title)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-sans font-medium transition-all',
                'bg-red-50 border border-red-200 text-red-500 hover:bg-red-100 hover:border-red-300'
              )}
              title="Delete book"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Confirm Delete"
        message={bookToDelete ? `Confirm delete "${bookToDelete.name}"? This cannot be undone.` : ''}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
