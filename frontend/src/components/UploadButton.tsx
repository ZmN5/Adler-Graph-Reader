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
            'flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-all',
            state === 'dragging'
              ? 'border-neon-cyan bg-neon-cyan/10 shadow-[0_0_20px_rgba(0,245,255,0.2)]'
              : 'border-white/20 hover:border-neon-cyan/40 hover:bg-white/5'
          )}
        >
          <div className={cn(
            'relative',
            state === 'dragging' && 'animate-bounce'
          )}>
            <Upload className={cn('h-10 w-10', state === 'dragging' ? 'text-neon-cyan' : 'text-slate-400')} />
            <div className={cn(
              'absolute inset-0 blur-md rounded-full transition-colors',
              state === 'dragging' ? 'bg-neon-cyan/40' : 'bg-transparent'
            )} />
          </div>
          <div className="text-center">
            <span className={cn(
              'text-sm font-space',
              state === 'dragging' ? 'text-neon-cyan' : 'text-slate-400'
            )}>
              Drop .pdf or .epub here, or click to upload
            </span>
            <p className="text-xs text-slate-500 mt-1 font-space">Your book will be processed to extract knowledge constellations</p>
          </div>
        </button>
      ) : state === 'configuring' ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-white/10 bg-space-deep/60 p-6 backdrop-blur-sm">
          <div className="relative">
            <Languages className="h-8 w-8 text-neon-purple" />
            <div className="absolute inset-0 blur-md bg-neon-purple/30 rounded-full" />
          </div>
          <span className="font-space font-medium text-white truncate max-w-full">{pendingFile?.name}</span>
          <div className="w-full max-w-xs space-y-2">
            <label className="text-sm font-space font-medium text-slate-300 mb-2 block">
              Extraction Language
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as BookLanguage)}
              className="w-full rounded-md border border-white/20 bg-space-deep/80 px-3 py-2 text-sm font-space text-white focus:border-neon-cyan/50 focus:outline-none focus:ring-1 focus:ring-neon-cyan/30"
            >
              <option value="auto">Auto-detect</option>
              <option value="zh">Chinese (中文)</option>
              <option value="en">English</option>
            </select>
            <p className="text-xs text-slate-500 font-space">
              Select the language for concept extraction
            </p>
          </div>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={handleDismiss}
              className="flex-1 rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-space font-medium text-slate-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              className="flex-1 rounded-md bg-neon-cyan/20 border border-neon-cyan/40 px-4 py-2 text-sm font-space font-medium text-neon-cyan hover:bg-neon-cyan/30 hover:border-neon-cyan/60 transition-all shadow-[0_0_10px_rgba(0,245,255,0.2)]"
            >
              Launch Upload
            </button>
          </div>
        </div>
      ) : state === 'uploading' ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-white/10 bg-space-deep/60 p-6 backdrop-blur-sm">
          <div className="relative">
            <FileText className="h-8 w-8 text-neon-cyan animate-pulse" />
            <div className="absolute inset-0 blur-md bg-neon-cyan/30 rounded-full animate-ping" />
          </div>
          <div className="w-full max-w-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-neon-cyan to-neon-purple transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-sm text-slate-300 font-space">
            Transmitting to cosmos... {Math.round(progress)}%
          </span>
        </div>
      ) : state === 'success' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6 backdrop-blur-sm">
          <div className="relative">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
            <div className="absolute inset-0 blur-md bg-emerald-400/30 rounded-full" />
          </div>
          <span className="font-space font-medium text-emerald-400">
            Transmission successful!
          </span>
          <span className="text-sm text-slate-400 font-space truncate max-w-full">
            {successData?.title}
          </span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-slate-400 hover:text-white font-space transition-colors"
          >
            Upload another
          </button>
        </div>
      ) : state === 'error' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-6 backdrop-blur-sm">
          <div className="relative">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <div className="absolute inset-0 blur-md bg-red-400/30 rounded-full" />
          </div>
          <span className="font-space font-medium text-red-400 text-center">{error}</span>
          <button
            onClick={handleDismiss}
            className="mt-2 text-sm text-slate-400 hover:text-white font-space transition-colors"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
