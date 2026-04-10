import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getLanguage, setLanguage, Language } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { Globe } from 'lucide-react'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { setLanguage: setGlobalLanguage } = useAppStore()
  const [localLanguage, setLocalLanguage] = useState<Language>('zh')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getLanguage()
      .then((lang) => {
        setLocalLanguage(lang)
        setGlobalLanguage(lang)
      })
      .catch(() => {
        setLocalLanguage('zh')
        setGlobalLanguage('zh')
      })
      .finally(() => setIsLoading(false))
  }, [setGlobalLanguage])

  const handleToggle = useCallback(async () => {
    const newLanguage = localLanguage === 'zh' ? 'en' : 'zh'
    try {
      await setLanguage(newLanguage)
      setLocalLanguage(newLanguage)
      setGlobalLanguage(newLanguage)
    } catch {
      // Keep current language on error
    }
  }, [localLanguage, setGlobalLanguage])

  if (isLoading) {
    return (
      <div className={cn('h-9 w-16 animate-pulse rounded-full bg-white/10', className)} />
    )
  }

  return (
    <button
      onClick={handleToggle}
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-space font-medium transition-all',
        'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20',
        'text-slate-300 hover:text-white',
        className
      )}
      title="Toggle language"
    >
      <Globe className="h-4 w-4 text-neon-cyan" />
      <span>{localLanguage === 'zh' ? '中文' : 'EN'}</span>
    </button>
  )
}
