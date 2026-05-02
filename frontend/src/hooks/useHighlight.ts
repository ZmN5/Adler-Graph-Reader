import { useState, useCallback, useEffect, useRef } from 'react'

const HIGHLIGHT_DURATION = 3000 // 3 seconds

export function useHighlight() {
  const [activeHighlights, setActiveHighlights] = useState<Map<string, number>>(new Map())
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const timeouts = timeoutsRef.current
      timeouts.forEach((timeout) => clearTimeout(timeout))
    }
  }, [])

  const addHighlight = useCallback((chunkId: string) => {
    const now = Date.now()

    // Clear existing timeout for this chunk if any
    const existingTimeout = timeoutsRef.current.get(chunkId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    setActiveHighlights((prev) => {
      const next = new Map(prev)
      next.set(chunkId, now)
      return next
    })

    // Set timeout to remove highlight
    const timeout = setTimeout(() => {
      setActiveHighlights((prev) => {
        const next = new Map(prev)
        next.delete(chunkId)
        return next
      })
      timeoutsRef.current.delete(chunkId)
    }, HIGHLIGHT_DURATION)

    timeoutsRef.current.set(chunkId, timeout)
  }, [])

  const removeHighlight = useCallback((chunkId: string) => {
    const existingTimeout = timeoutsRef.current.get(chunkId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      timeoutsRef.current.delete(chunkId)
    }

    setActiveHighlights((prev) => {
      const next = new Map(prev)
      next.delete(chunkId)
      return next
    })
  }, [])

  const clearAllHighlights = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
    timeoutsRef.current.clear()
    setActiveHighlights(new Map())
  }, [])

  const isHighlighted = useCallback(
    (chunkId: string): boolean => {
      return activeHighlights.has(chunkId)
    },
    [activeHighlights]
  )

  return {
    activeHighlights,
    addHighlight,
    removeHighlight,
    clearAllHighlights,
    isHighlighted,
  }
}
