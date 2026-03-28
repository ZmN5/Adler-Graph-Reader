import { useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type LayoutMode = 'horizontal' | 'vertical'

interface SplitPaneProps {
  leftPane: ReactNode
  rightPane: ReactNode
  className?: string
  defaultMode?: LayoutMode
  defaultSplit?: number
  minPaneSize?: number
  storageKey?: string
}

const STORAGE_KEY = 'split-pane-layout'
const DEFAULT_SPLIT = 50
const MIN_PANE_PERCENT = 20

interface LayoutConfig {
  mode: LayoutMode
  split: number
}

function loadLayoutConfig(storageKey: string): LayoutConfig {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      return JSON.parse(stored) as LayoutConfig
    }
  } catch {
    // Ignore parse errors
  }
  return { mode: 'horizontal', split: DEFAULT_SPLIT }
}

function saveLayoutConfig(storageKey: string, config: LayoutConfig): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(config))
  } catch {
    // Ignore storage errors
  }
}

export function SplitPane({
  leftPane,
  rightPane,
  className,
  defaultMode = 'horizontal',
  defaultSplit = DEFAULT_SPLIT,
  minPaneSize = MIN_PANE_PERCENT,
  storageKey = STORAGE_KEY,
}: SplitPaneProps) {
  const [config, setConfig] = useState<LayoutConfig>(() => {
    const stored = loadLayoutConfig(storageKey)
    return {
      mode: stored.mode || defaultMode,
      split: stored.split ?? defaultSplit,
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saveLayoutConfig(storageKey, config)
  }, [config, storageKey])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      let percentage: number

      if (config.mode === 'horizontal') {
        percentage = ((e.clientX - rect.left) / rect.width) * 100
      } else {
        percentage = ((e.clientY - rect.top) / rect.height) * 100
      }

      // Clamp to min/max
      percentage = Math.max(minPaneSize, Math.min(100 - minPaneSize, percentage))
      setConfig((prev) => ({ ...prev, split: percentage }))
    },
    [isDragging, config.mode, minPaneSize]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = config.mode === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp, config.mode])

  const isHorizontal = config.mode === 'horizontal'

  return (
    <div className={cn('flex h-full w-full', className)}>
      <div
        ref={containerRef}
        className={cn(
          'flex h-full w-full',
          isHorizontal ? 'flex-row' : 'flex-col'
        )}
      >
        <div
          style={{
            [isHorizontal ? 'width' : 'height']: `${config.split}%`,
          }}
          className="overflow-hidden"
        >
          {leftPane}
        </div>

        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'group flex shrink-0 items-center justify-center bg-muted/50 transition-colors hover:bg-primary/20',
            isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
            isDragging && 'bg-primary'
          )}
        >
          <div
            className={cn(
              'rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-primary',
              isHorizontal ? 'h-12 w-1' : 'h-1 w-12'
            )}
          />
        </div>

        <div
          style={{
            [isHorizontal ? 'width' : 'height']: `${100 - config.split}%`,
          }}
          className="overflow-hidden"
        >
          {rightPane}
        </div>
      </div>
    </div>
  )
}