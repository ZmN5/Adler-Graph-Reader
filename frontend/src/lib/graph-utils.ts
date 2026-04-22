// Space theme category colors mapping - planet colors with glow
export const PLANET_COLORS: Record<string, { base: string; glow: string; atmosphere: string }> = {
  Philosophy: { base: '#6366f1', glow: '#818cf8', atmosphere: 'rgba(99, 102, 241, 0.4)' },
  Science: { base: '#10b981', glow: '#34d399', atmosphere: 'rgba(16, 185, 129, 0.4)' },
  History: { base: '#f59e0b', glow: '#fbbf24', atmosphere: 'rgba(245, 158, 11, 0.4)' },
  Art: { base: '#ec4899', glow: '#f472b6', atmosphere: 'rgba(236, 72, 153, 0.4)' },
  Technology: { base: '#06b6d4', glow: '#22d3ee', atmosphere: 'rgba(6, 182, 212, 0.4)' },
  Politics: { base: '#ef4444', glow: '#f87171', atmosphere: 'rgba(239, 68, 68, 0.4)' },
  Economics: { base: '#84cc16', glow: '#a3e635', atmosphere: 'rgba(132, 204, 22, 0.4)' },
  Psychology: { base: '#a855f7', glow: '#c084fc', atmosphere: 'rgba(168, 85, 247, 0.4)' },
  Other: { base: '#64748b', glow: '#94a3b8', atmosphere: 'rgba(100, 116, 139, 0.4)' },
}

// Core concepts get special cyan glow
export const CORE_COLOR = { base: '#00f5ff', glow: '#67e8f9', atmosphere: 'rgba(0, 245, 255, 0.5)' }

export const DEFAULT_PLANET_COLOR = { base: '#64748b', glow: '#94a3b8', atmosphere: 'rgba(100, 116, 139, 0.3)' }

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
