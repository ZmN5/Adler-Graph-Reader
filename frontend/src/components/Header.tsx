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
        'sticky top-0 z-50 w-full bg-white border-b border-gray-200 shadow-apple-sm',
        className
      )}
    >
      <div className="container flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Logo - Stylized graph icon */}
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7 text-apple-blue"
            >
              <circle cx="12" cy="12" r="10" className="opacity-50" />
              <circle cx="12" cy="12" r="4" className="fill-apple-blue/20" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" className="opacity-30" />
              <path d="M2 12h20" className="opacity-30" />
              {/* Orbital paths */}
              <ellipse cx="12" cy="12" rx="7" ry="3" className="opacity-20" />
              <circle cx="5" cy="12" r="1" className="fill-apple-pink" />
              <circle cx="19" cy="12" r="1.5" className="fill-apple-purple" />
            </svg>
          </div>

          <div className="flex flex-col">
            <span className="font-sans font-semibold text-base tracking-tight text-gray-900">
              COSMIC<span className="text-apple-blue">KNOWLEDGE</span>
            </span>
            <span className="text-[10px] text-gray-400 tracking-widest uppercase font-sans hidden sm:block">
              Intelligent Reading Concept Graph
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSettingsClick}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium font-sans',
              'text-gray-500 hover:text-gray-900 transition-all',
              'hover:bg-gray-100 border border-transparent hover:border-gray-200'
            )}
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
