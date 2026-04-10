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
        className="absolute inset-0 bg-space-void/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-10 w-full max-w-md mx-4 rounded-xl shadow-2xl glass-panel border border-white/20',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-white/10">
          {variant === 'danger' && (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 border border-red-500/30">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
          )}
          <h2 id="confirm-dialog-title" className="text-lg font-space font-semibold text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          <p className="text-slate-300 font-space">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-white/10 bg-space-deep/30 rounded-b-xl">
          <button
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg font-space font-medium transition-colors',
              'bg-white/5 border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white'
            )}
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={cn(
              'px-4 py-2 rounded-lg font-space font-medium transition-all',
              variant === 'danger'
                ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 hover:border-red-500/60'
                : 'bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/30 hover:border-neon-cyan/60'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
