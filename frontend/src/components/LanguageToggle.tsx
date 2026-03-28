import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getLanguage, setLanguage, Language } from '@/lib/api-client'
import { Globe } from 'lucide-react'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const [language, setLocalLanguage] = useState<Language>('zh')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getLanguage()
      .then(setLocalLanguage)
      .catch(() => setLocalLanguage('zh'))
      .finally(() => setIsLoading(false))
  }, [])

  const handleToggle = useCallback(async () => {
    const newLanguage = language === 'zh' ? 'en' : 'zh'
    try {
      await setLanguage(newLanguage)
      setLocalLanguage(newLanguage)
    } catch {
      // Keep current language on error
    }
  }, [language])

  if (isLoading) {
    return (
      <div className={cn('h-9 w-14 animate-pulse rounded-full bg-muted', className)} />
    )
  }

  return (
    <button
      onClick={handleToggle}
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        'bg-muted hover:bg-muted/80',
        className
      )}
      title="Toggle language"
    >
      <Globe className="h-4 w-4" />
      <span>{language === 'zh' ? '中文' : 'EN'}</span>
    </button>
  )
}