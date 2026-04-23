// Apple-style category colors mapping - adapted for light backgrounds
export const PLANET_COLORS: Record<string, { base: string; glow: string; atmosphere: string }> = {
  Philosophy: { base: '#5856D6', glow: '#7A78E0', atmosphere: 'rgba(88, 86, 214, 0.25)' },
  Science: { base: '#34C759', glow: '#5DD47A', atmosphere: 'rgba(52, 199, 89, 0.25)' },
  History: { base: '#FF9500', glow: '#FFAA33', atmosphere: 'rgba(255, 149, 0, 0.25)' },
  Art: { base: '#FF2D55', glow: '#FF5C7F', atmosphere: 'rgba(255, 45, 85, 0.25)' },
  Technology: { base: '#5AC8FA', glow: '#7DD4FB', atmosphere: 'rgba(90, 200, 250, 0.25)' },
  Politics: { base: '#FF3B30', glow: '#FF6B63', atmosphere: 'rgba(255, 59, 48, 0.25)' },
  Economics: { base: '#A2845E', glow: '#B59D7E', atmosphere: 'rgba(162, 132, 94, 0.25)' },
  Psychology: { base: '#AF52DE', glow: '#C27DE6', atmosphere: 'rgba(175, 82, 222, 0.25)' },
  Other: { base: '#8E8E93', glow: '#A5A5AA', atmosphere: 'rgba(142, 142, 147, 0.25)' },
}

// Core concepts get Apple system blue
export const CORE_COLOR = { base: '#007AFF', glow: '#3395FF', atmosphere: 'rgba(0, 122, 255, 0.3)' }

export const DEFAULT_PLANET_COLOR = { base: '#8E8E93', glow: '#A5A5AA', atmosphere: 'rgba(142, 142, 147, 0.2)' }

export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const amt = Math.round(2.55 * percent)
  const R = Math.min(255, (num >> 16) + amt)
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt)
  const B = Math.min(255, (num & 0x0000FF) + amt)
  return `rgb(${R}, ${G}, ${B})`
}

export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const amt = Math.round(2.55 * percent)
  const R = Math.max(0, (num >> 16) - amt)
  const G = Math.max(0, ((num >> 8) & 0x00FF) - amt)
  const B = Math.max(0, (num & 0x0000FF) - amt)
  return `rgb(${R}, ${G}, ${B})`
}
