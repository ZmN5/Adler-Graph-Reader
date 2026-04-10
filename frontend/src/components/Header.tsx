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
        'sticky top-0 z-50 w-full glass-panel border-b border-neon-cyan/20',
        className
      )}
    >
      <div className="container flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {/* Logo - Stylized cosmic graph icon */}
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7 text-neon-cyan"
            >
              <circle cx="12" cy="12" r="10" className="opacity-50" />
              <circle cx="12" cy="12" r="4" className="fill-neon-cyan/20" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" className="opacity-30" />
              <path d="M2 12h20" className="opacity-30" />
              {/* Orbital paths */}
              <ellipse cx="12" cy="12" rx="7" ry="3" className="opacity-20" />
              <circle cx="5" cy="12" r="1" className="fill-neon-pink" />
              <circle cx="19" cy="12" r="1.5" className="fill-neon-purple" />
            </svg>
            <div className="absolute inset-0 blur-md bg-neon-cyan/30 rounded-full" />
          </div>
          
          <div className="flex flex-col">
            <span className="font-orbitron font-bold text-lg tracking-wide text-white glow-text">
              COSMIC<span className="text-neon-cyan">KNOWLEDGE</span>
            </span>
            <span className="text-[10px] text-slate-500 tracking-widest uppercase font-space hidden sm:block">
              Intelligent Reading Concept Graph
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={onSettingsClick}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium font-space',
              'text-slate-400 hover:text-white transition-all',
              'hover:bg-white/5 border border-transparent hover:border-white/10'
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
