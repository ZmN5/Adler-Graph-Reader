import { cn } from '@/lib/utils'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Settings } from 'lucide-react'

interface HeaderProps {
  className?: string
  onSettingsClick?: () => void
}

export function Header({ className, onSettingsClick }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
          <span className="hidden sm:inline-block">Intelligent Reading Concept Graph</span>
          <span className="sm:hidden">IRCG</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onSettingsClick}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
          <LanguageToggle />
        </div>
      </div>
    </header>
  )
}