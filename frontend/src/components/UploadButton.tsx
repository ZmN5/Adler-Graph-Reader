import { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { apiUploadBook, UploadBookResponse, BookLanguage } from '@/lib/api-client'
import { Upload, FileText, CheckCircle, AlertCircle, Languages } from 'lucide-react'

interface UploadButtonProps {
  className?: string
  onUploadSuccess?: (response: UploadBookResponse) => void
}

type UploadState = 'idle' | 'configuring' | 'dragging' | 'uploading' | 'success' | 'error'

export function UploadButton({ className, onUploadSuccess }: UploadButtonProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [successData, setSuccessData] = useState<UploadBookResponse | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<BookLanguage>('auto')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const handleFile = useCallback((file: File) => {
    const validExtensions = ['.pdf', '.epub']
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    if (!validExtensions.includes(extension)) {
      setError('Invalid file format. Please upload a .pdf or .epub file.')
      setState('error')
      return
    }

    setPendingFile(file)
    setState('configuring')
    setError(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!pendingFile) return

    setState('uploading')
    setProgress(0)

    try {
      const title = pendingFile.name.replace(/\.(pdf|epub)$/i, '')
      const response = await apiUploadBook(
        pendingFile,
        title,
        undefined,
        selectedLanguage,
        (p) => setProgress(p)
      )
      setSuccessData(response)
      setState('success')
      setPendingFile(null)
      onUploadSuccess?.(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setState('error')
      setPendingFile(null)
    }
  }, [pendingFile, selectedLanguage, onUploadSuccess])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setState('dragging')
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0 && state !== 'configuring') {
      setState('idle')
    }
  }, [state])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setState('idle')

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0])
    }
  }, [handleFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0])
    }
  }, [handleFile])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleDismiss = useCallback(() => {
    setState('idle')
    setProgress(0)
    setError(null)
    setSuccessData(null)
    setPendingFile(null)
    setSelectedLanguage('auto')
  }, [])

  return (
    <div className={cn('relative', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub"
        onChange={handleFileSelect}
        className="hidden"
      />

      {state === 'idle' || state === 'dragging' ? (
        <button
          onClick={handleClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors',
            state === 'dragging'
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
          )}
        >
          <Upload className={cn('h-8 w-8', state === 'dragging' ? 'text-primary' : 'text-muted-foreground')} />
          <span className="text-sm text-muted-foreground">
            Drop .pdf or .epub here, or click to upload
          </span>
        </button>
      ) : state === 'configuring' ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border p-6">
          <Languages className="h-8 w-8 text-primary" />
          <span className="font-medium">{pendingFile?.name}</span>
          <div className="w-full max-w-xs">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Extraction Language
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as BookLanguage)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="auto">Auto-detect</option>
              <option value="zh">Chinese (中文)</option>
              <option value="en">English</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Select the language for concept extraction
            </p>
          </div>
          <div className="flex gap-2 w-full max-w-xs">
            <button
              onClick={handleDismiss}
              className="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Upload
            </button>
          </div>
        </div>
      ) : state === 'uploading' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-6">
          <FileText className="h-8 w-8 text-primary animate-pulse" />
          <div className="w-full max-w-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-sm text-muted-foreground">
            Uploading... {Math.round(progress)}%
          </span>
        </div>
      ) : state === 'success' ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-6">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <span className="font-medium text-green-600 dark:text-green-400">
            Upload successful!
          </span>
          <span className="text-sm text-muted-foreground">
            {successData?.title}
          </span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-muted-foreground underline hover:text-foreground"
          >
            Upload another
          </button>
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-6">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <span className="font-medium text-destructive">{error}</span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-muted-foreground underline hover:text-foreground"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}