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
            'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 transition-all w-full',
            state === 'dragging'
              ? 'border-apple-blue bg-blue-50/50'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          )}
        >
          <div className={cn(
            'relative',
            state === 'dragging' && 'animate-bounce'
          )}>
            <Upload className={cn('h-10 w-10', state === 'dragging' ? 'text-apple-blue' : 'text-gray-400')} />
          </div>
          <div className="text-center">
            <span className={cn(
              'text-sm font-sans',
              state === 'dragging' ? 'text-apple-blue' : 'text-gray-500'
            )}>
              Drop .pdf or .epub here, or click to upload
            </span>
            <p className="text-xs text-gray-400 mt-1 font-sans">Your book will be processed to extract knowledge concepts</p>
          </div>
        </button>
      ) : state === 'configuring' ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-apple-md">
          <div className="relative">
            <Languages className="h-8 w-8 text-apple-purple" />
          </div>
          <span className="font-sans font-medium text-gray-900 truncate max-w-full">{pendingFile?.name}</span>
          <div className="w-full max-w-xs space-y-2">
            <label className="text-sm font-sans font-medium text-gray-700 mb-2 block">
              Extraction Language
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as BookLanguage)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-sans text-gray-900 focus:border-apple-blue focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
            >
              <option value="auto">Auto-detect</option>
              <option value="zh">Chinese (中文)</option>
              <option value="en">English</option>
            </select>
            <p className="text-xs text-gray-400 font-sans">
              Select the language for concept extraction
            </p>
          </div>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={handleDismiss}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-sans font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              className="flex-1 rounded-lg bg-apple-blue px-4 py-2 text-sm font-sans font-medium text-white hover:bg-blue-600 transition-colors"
            >
              Upload
            </button>
          </div>
        </div>
      ) : state === 'uploading' ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-apple-md">
          <div className="relative">
            <FileText className="h-8 w-8 text-apple-blue animate-pulse" />
          </div>
          <div className="w-full max-w-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-apple-blue transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-sm text-gray-600 font-sans">
            Uploading... {Math.round(progress)}%
          </span>
        </div>
      ) : state === 'success' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-6">
          <div className="relative">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <span className="font-sans font-medium text-green-700">
            Upload successful!
          </span>
          <span className="text-sm text-gray-500 font-sans truncate max-w-full">
            {successData?.title}
          </span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-gray-500 hover:text-gray-900 font-sans transition-colors"
          >
            Upload another
          </button>
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="relative">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <span className="font-sans font-medium text-red-600 text-center">{error}</span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-gray-500 hover:text-gray-900 font-sans transition-colors"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
