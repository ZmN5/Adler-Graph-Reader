import { ReactNode, useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ThreeColumnLayoutProps {
  /** Left panel - typically PDF/EPUB reader */
  leftPanel: ReactNode
  /** Center panel - typically graph view */
  centerPanel: ReactNode
  /** Right panel - typically detail panel */
  rightPanel: ReactNode
  /** Whether right panel is visible */
  showRightPanel: boolean
  /** Width of right panel in pixels */
  rightPanelWidth?: number
  className?: string
  /** Whether left panel is collapsed */
  isLeftPanelCollapsed?: boolean
  /** Callback when left panel collapse state changes */
  onLeftPanelCollapseChange?: (collapsed: boolean) => void
  /** Title to show in collapsed left panel bar */
  leftPanelTitle?: string
}

const DEFAULT_RIGHT_PANEL_WIDTH = 280
const MIN_LEFT_PANEL_WIDTH = 320
const MAX_LEFT_PANEL_WIDTH_PERCENT = 60

/**
 * A three-column layout component that shows:
 * - Left panel: Book reader (resizable, collapsible to 48px)
 * - Center panel: Graph view (adapts to left/right panel sizes)
 * - Right panel: Detail panel (280px fixed width)
 *
 * Layout structure:
 * | Left (resizable) | Center | Right 280px (or hidden) |
 */
export function ThreeColumnLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  showRightPanel,
  rightPanelWidth = DEFAULT_RIGHT_PANEL_WIDTH,
  className,
  isLeftPanelCollapsed = false,
  onLeftPanelCollapseChange,
  leftPanelTitle,
}: ThreeColumnLayoutProps) {
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    // Initialize from localStorage or default to 40% of viewport
    const saved = localStorage.getItem('readerPanelWidth')
    return saved ? parseInt(saved, 10) : Math.max(MIN_LEFT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.4))
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  // Save panel width to localStorage when it changes
  useEffect(() => {
    if (!isLeftPanelCollapsed) {
      localStorage.setItem('readerPanelWidth', leftPanelWidth.toString())
    }
  }, [leftPanelWidth, isLeftPanelCollapsed])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = leftPanelWidth

    // Add global event listeners for drag
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [leftPanelWidth])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartXRef.current
      const containerWidth = containerRef.current?.clientWidth || window.innerWidth
      const maxWidth = Math.floor(containerWidth * MAX_LEFT_PANEL_WIDTH_PERCENT / 100)
      const newWidth = Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxWidth, dragStartWidthRef.current + deltaX))
      setLeftPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full w-full overflow-hidden',
        isDragging && 'cursor-col-resize',
        className
      )}
    >
      {/* Left Panel - resizable (collapsible to 48px) */}
      <div
        className={cn(
          'relative overflow-hidden bg-background border-r transition-all duration-300 ease-in-out flex-shrink-0',
          isLeftPanelCollapsed ? 'w-12' : 'min-w-0'
        )}
        style={isLeftPanelCollapsed ? undefined : { width: leftPanelWidth, flex: 'none' }}
      >
        {isLeftPanelCollapsed ? (
          /* Collapsed state - show narrow bar with expand button */
          <div className="h-full flex flex-col items-center py-3">
            <button
              onClick={() => onLeftPanelCollapseChange?.(false)}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              title="Expand reader panel"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            {leftPanelTitle && (
              <div
                className="mt-4 text-xs text-muted-foreground writing-vertical"
                style={{
                  writingMode: 'vertical-rl',
                  textOrientation: 'mixed',
                }}
              >
                <span className="truncate max-h-[200px] inline-block">
                  {leftPanelTitle}
                </span>
              </div>
            )}
          </div>
        ) : (
          /* Expanded state - show full reader */
          <>
            {leftPanel}
            {/* Collapse button - positioned at right edge of panel */}
            <button
              onClick={() => onLeftPanelCollapseChange?.(true)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-background/80 hover:bg-muted transition-colors shadow-sm border"
              title="Collapse reader panel"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {/* Resize handle - drag to resize panel */}
            <div
              onMouseDown={handleResizeStart}
              className={cn(
                'absolute top-0 right-0 bottom-0 w-2 cursor-col-resize z-20',
                'hover:bg-primary/20 active:bg-primary/40 transition-colors',
                isDragging && 'bg-primary/30'
              )}
              title="Drag to resize panel"
            >
              {/* Visual indicator line */}
              <div className={cn(
                'absolute top-1/2 right-0 -translate-y-1/2 w-0.5 h-8 rounded-full',
                'bg-border hover:bg-primary/50',
                isDragging && 'bg-primary'
              )} />
            </div>
          </>
        )}
      </div>

      {/* Center Panel - Graph view (expands when right panel is hidden or left is collapsed) */}
      <div
        className={cn(
          'min-w-0 overflow-hidden border-l transition-all duration-300 ease-in-out flex-1'
        )}
      >
        {centerPanel}
      </div>

      {/* Right Panel - Detail Panel */}
      {showRightPanel && (
        <div
          className="border-l bg-background overflow-hidden transition-all duration-300 ease-in-out flex-shrink-0"
          style={{ width: rightPanelWidth }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  )
}
