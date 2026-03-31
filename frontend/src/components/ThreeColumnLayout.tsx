import { ReactNode } from 'react'
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

/**
 * A three-column layout component that shows:
 * - Left panel: Book reader (40%, collapsible to 48px)
 * - Center panel: Graph view (50%, expands when left is collapsed)
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
  isLeftPanelCollapsed = false,
  onLeftPanelCollapseChange,
  leftPanelTitle,
}: ThreeColumnLayoutProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full overflow-hidden',
        className
      )}
    >
      {/* Left Panel - 40% (collapsible to 48px) */}
      <div
        className={cn(
          'relative overflow-hidden bg-background border-r transition-all duration-300 ease-in-out flex-shrink-0',
          isLeftPanelCollapsed ? 'w-12' : 'flex-[4] min-w-0'
        )}
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
          </>
        )}
      </div>

      {/* Center Panel - 50% (grows when right panel is hidden or left is collapsed) */}
      <div
        className={cn(
          'min-w-0 overflow-hidden border-l transition-all duration-300 ease-in-out',
          isLeftPanelCollapsed && showRightPanel ? 'flex-[9]' : 'flex-[5]',
          !showRightPanel && isLeftPanelCollapsed ? 'flex-[12]' : !showRightPanel ? 'flex-[9]' : ''
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
