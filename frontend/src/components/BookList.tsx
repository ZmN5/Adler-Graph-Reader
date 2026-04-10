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
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium font-space',
          isPdf 
            ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
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
        <div className="h-8 w-8 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
        <span className="ml-3 text-slate-400 font-space">Scanning cosmic library...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('text-center text-red-400 py-8 font-space', className)}>
        <p>{error}</p>
        <button onClick={loadBooks} className="mt-2 text-sm text-slate-400 hover:text-white transition-colors">
          Try again
        </button>
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div className={cn('text-center text-slate-400 py-12', className)}>
        <div className="relative inline-block">
          <Book className="mx-auto h-14 w-14 text-slate-600" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-neon-cyan/50 animate-ping" />
          </div>
        </div>
        <p className="mt-4 text-slate-300 font-space">No books in your cosmic library</p>
        <p className="text-sm text-slate-500 mt-1 font-space">Upload a book to begin your journey</p>
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
            'group flex items-center gap-4 rounded-lg border bg-space-deep/60 backdrop-blur-sm p-4 transition-all cursor-pointer',
            'hover:border-neon-cyan/30 hover:bg-space-deep/80',
            'border-white/10 hover:shadow-[0_0_20px_rgba(0,245,255,0.1)]'
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-space-nebula/50 border border-white/10">
            <Book className="h-6 w-6 text-neon-cyan/70" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-space font-semibold text-white truncate">{book.title}</h3>
              {formatBadge(book.format)}
              {extractingBookId === book.id && (
                <span className="inline-flex items-center gap-1 text-xs text-neon-purple font-space">
                  <div className="h-3 w-3 border border-neon-purple/30 border-t-neon-purple rounded-full animate-spin" />
                  Extracting...
                </span>
              )}
              {extractionResult?.bookId === book.id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/30 font-space">
                  <CheckCircle className="h-3 w-3" />
                  {extractionResult.nodesCount} nodes, {extractionResult.edgesCount} edges
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-sm text-slate-400 font-space">
              {book.author && <span>{book.author}</span>}
              {book.total_pages && <span>{book.total_pages} pages</span>}
              {!book.total_pages && (
                <span className="text-neon-orange/70 text-xs">Not parsed yet</span>
              )}
            </div>
            {extractionError?.bookId === book.id && (
              <p className="mt-1 text-xs text-red-400 font-space">{extractionError.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {book.total_pages == null ? (
              <button
                onClick={(e) => handleParse(e, book)}
                disabled={parsingBookId === book.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-space font-medium transition-all',
                  'bg-blue-500/20 border border-blue-500/40 text-blue-400 hover:bg-blue-500/30 hover:border-blue-500/60',
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
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-space font-medium transition-all',
                  'bg-neon-purple/20 border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/30 hover:border-neon-purple/60',
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
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-space font-medium transition-all',
                'bg-red-500/10 border border-red-500/30 text-red-400/70 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400'
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
