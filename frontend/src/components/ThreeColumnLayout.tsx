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

const DEFAULT_RIGHT_PANEL_WIDTH = 320

/**
 * A three-column layout component that shows:
 * - Left panel: Fixed width (flexible via parent)
 * - Center panel: Flexible width that takes remaining space
 * - Right panel: Collapsible detail panel with fixed width
 *
 * Layout structure:
 * | Left | Center | Right (collapsible) |
 * |  ~40% |   ~60%  |     320px (or hidden) |
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
      {/* Left Panel */}
      <div className="flex-1 min-w-0 overflow-hidden">{leftPanel}</div>

      {/* Center Panel - grows to fill space when right panel is hidden */}
      <div
        className={cn(
          'flex-1 min-w-0 overflow-hidden border-l',
          !showRightPanel && 'flex-[2]'
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
