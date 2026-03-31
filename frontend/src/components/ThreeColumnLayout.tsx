import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
}

const DEFAULT_RIGHT_PANEL_WIDTH = 280

/**
 * A three-column layout component that shows:
 * - Left panel: Book reader (40%)
 * - Center panel: Graph view (50%)
 * - Right panel: Detail panel (280px fixed width)
 *
 * Layout structure:
 * | Left 40% | Center 50% | Right 280px (or hidden) |
 */
export function ThreeColumnLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  showRightPanel,
  rightPanelWidth = DEFAULT_RIGHT_PANEL_WIDTH,
  className,
}: ThreeColumnLayoutProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full overflow-hidden',
        className
      )}
    >
      {/* Left Panel - 40% */}
      <div className="flex-[4] min-w-0 overflow-hidden">{leftPanel}</div>

      {/* Center Panel - 50% (grows when right panel is hidden) */}
      <div
        className={cn(
          'flex-[5] min-w-0 overflow-hidden border-l',
          !showRightPanel && 'flex-[9]'
        )}
      >
        {centerPanel}
      </div>

      {/* Right Panel - Detail Panel */}
      {showRightPanel && (
        <div
          className="border-l bg-background overflow-hidden"
          style={{ width: rightPanelWidth, flexShrink: 0 }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  )
}
