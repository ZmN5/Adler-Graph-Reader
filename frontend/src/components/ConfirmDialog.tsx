import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'default'
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-10 w-full max-w-md mx-4 rounded-2xl shadow-2xl bg-white border border-gray-200',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-gray-200">
          {variant === 'danger' && (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 border border-red-200">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
          )}
          <h2 id="confirm-dialog-title" className="text-lg font-sans font-semibold text-gray-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          <p className="text-gray-600 font-sans">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg font-sans font-medium transition-colors',
              'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={cn(
              'px-4 py-2 rounded-lg font-sans font-medium transition-all',
              variant === 'danger'
                ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300'
                : 'bg-apple-blue text-white hover:bg-blue-600'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
