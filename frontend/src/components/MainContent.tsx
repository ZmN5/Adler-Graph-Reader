import { cn } from '@/lib/utils'

interface MainContentProps {
  className?: string
  children?: React.ReactNode
}

export function MainContent({ className, children }: MainContentProps) {
  return (
    <main className={cn('container py-8 px-4', className)}>
      {children}
    </main>
  )
}
