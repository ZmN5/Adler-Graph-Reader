import type { NodeObject, LinkObject } from 'react-force-graph-2d'
import {
  PLANET_COLORS,
  CORE_COLOR,
  DEFAULT_PLANET_COLOR,
  lightenColor,
  darkenColor,
} from '@/lib/graph-utils'
import type { ExtendedNode, ExtendedLink } from '@/hooks/useGraphCanvas'

export interface PulseTimeSource {
  current: number
}

export function createNodeCanvasObject(
  selectedNodeId: string | null | undefined,
  hoveredNode: ExtendedNode | null,
  pulseTimeSource: PulseTimeSource
) {
  return (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    // Guard: skip nodes without valid position
    if (node.x === undefined || node.y === undefined ||
        !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      return
    }

    const extNode = node as ExtendedNode
    const label = extNode.name
    const shortLabel = label.length > 15 ? label.substring(0, 12) + '...' : label

    // Minimum node size (increased for better clickability)
    const MIN_NODE_SIZE = 6
    const MAX_NODE_SIZE = 22

    // Calculate node size based on source_chunk_ids count
    const sizeMultiplier = extNode.is_core ? 1.8 : 1.2
    const baseSize = Math.min(
      MIN_NODE_SIZE + extNode.source_chunk_ids.length * 0.6,
      MAX_NODE_SIZE
    )
    const nodeSize = baseSize * sizeMultiplier

    // Hover effect: increase size when hovered
    const isSelected = extNode.id === selectedNodeId
    const isHovered = extNode.id === hoveredNode?.id
    const displaySize = isHovered ? nodeSize * 1.2 : nodeSize

    // Get planet color based on category or core status
    let planetColor = DEFAULT_PLANET_COLOR
    if (extNode.is_core) {
      planetColor = CORE_COLOR
    } else if (extNode.category && PLANET_COLORS[extNode.category]) {
      planetColor = PLANET_COLORS[extNode.category]
    }

    // Pulse animation for core concepts
    const pulseTime = pulseTimeSource.current
    const pulseScale = extNode.is_core ? 1 + Math.sin(pulseTime * 2) * 0.08 : 1
    const finalSize = displaySize * pulseScale

    // Draw planetary glow/atmosphere for core concepts
    if (extNode.is_core) {
      const glowIntensity = 0.3 + Math.sin(pulseTime * 2) * 0.2
      const glowRadius = finalSize * (2.5 + Math.sin(pulseTime * 1.5) * 0.5)
      const glowGradient = ctx.createRadialGradient(
        node.x, node.y, finalSize * 0.8,
        node.x, node.y, glowRadius
      )
      glowGradient.addColorStop(0, planetColor.atmosphere.replace(/[\d.]+\)$/, `${glowIntensity})`))
      glowGradient.addColorStop(0.5, planetColor.atmosphere.replace(/[\d.]+\)$/, `${glowIntensity * 0.4})`))
      glowGradient.addColorStop(1, 'rgba(0, 122, 255, 0)')
      ctx.fillStyle = glowGradient
      ctx.beginPath()
      ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Draw hover glow for all nodes
    if (isHovered) {
      const hoverGlowGradient = ctx.createRadialGradient(
        node.x, node.y, finalSize * 0.5,
        node.x, node.y, finalSize * 2
      )
      hoverGlowGradient.addColorStop(0, `${planetColor.atmosphere}`)
      hoverGlowGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = hoverGlowGradient
      ctx.beginPath()
      ctx.arc(node.x, node.y, finalSize * 2, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Draw planet body with gradient
    const bodyGradient = ctx.createRadialGradient(
      node.x - finalSize * 0.3, node.y - finalSize * 0.3, 0,
      node.x, node.y, finalSize
    )
    bodyGradient.addColorStop(0, lightenColor(planetColor.base, 40))
    bodyGradient.addColorStop(0.5, planetColor.base)
    bodyGradient.addColorStop(1, darkenColor(planetColor.base, 30))

    ctx.beginPath()
    ctx.arc(node.x, node.y, finalSize, 0, 2 * Math.PI)
    ctx.fillStyle = bodyGradient
    ctx.fill()

    // Draw planetary ring for core concepts
    if (extNode.is_core && (isHovered || isSelected)) {
      ctx.save()
      ctx.translate(node.x, node.y)
      ctx.scale(1, 0.3)
      ctx.beginPath()
      ctx.arc(0, 0, finalSize * 1.8, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(0, 122, 255, ${isSelected ? 0.7 : 0.4})`
      ctx.lineWidth = 2 / globalScale
      ctx.stroke()
      ctx.restore()
    }

    // Draw selection border
    if (isSelected) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, finalSize + 3 / globalScale, 0, 2 * Math.PI)
      ctx.strokeStyle = '#007AFF'
      ctx.lineWidth = 2 / globalScale
      ctx.stroke()

      // Selection glow
      const selectionGlow = ctx.createRadialGradient(
        node.x, node.y, finalSize,
        node.x, node.y, finalSize + 8 / globalScale
      )
      selectionGlow.addColorStop(0, 'rgba(0, 122, 255, 0.5)')
      selectionGlow.addColorStop(1, 'rgba(0, 122, 255, 0)')
      ctx.fillStyle = selectionGlow
      ctx.fill()
    } else if (isHovered || extNode.is_core) {
      // Normal hover or core border
      ctx.beginPath()
      ctx.arc(node.x, node.y, finalSize + 2 / globalScale, 0, 2 * Math.PI)
      ctx.strokeStyle = extNode.is_core ? planetColor.glow : 'rgba(100, 116, 139, 0.5)'
      ctx.lineWidth = extNode.is_core ? 2 / globalScale : 1.5 / globalScale
      ctx.stroke()
    }

    // Draw specular highlight (shine)
    const highlightGradient = ctx.createRadialGradient(
      node.x - finalSize * 0.4, node.y - finalSize * 0.4, 0,
      node.x - finalSize * 0.4, node.y - finalSize * 0.4, finalSize * 0.6
    )
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
    highlightGradient.addColorStop(1, 'transparent')
    ctx.fillStyle = highlightGradient
    ctx.beginPath()
    ctx.arc(node.x, node.y, finalSize, 0, 2 * Math.PI)
    ctx.fill()

    // Draw label based on zoom level
    if (globalScale >= 0.3) {
      const MAX_FONT_SIZE = 14
      const fontSize = globalScale >= 0.8
        ? Math.min(12 / globalScale, MAX_FONT_SIZE)
        : Math.min(10 / globalScale, MAX_FONT_SIZE)

      const labelText = globalScale >= 0.8 ? label : shortLabel

      // Draw label background
      ctx.font = extNode.is_core ? `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif` : `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
      const textMetrics = ctx.measureText(labelText)
      const padding = 4 / globalScale
      const labelWidth = textMetrics.width + padding * 2
      const labelHeight = fontSize + padding * 2

      // Label background - white for light theme
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.beginPath()
      ctx.roundRect(
        node.x! - labelWidth / 2,
        node.y! + finalSize + 4 / globalScale,
        labelWidth,
        labelHeight,
        6 / globalScale
      )
      ctx.fill()

      // Label border glow for core concepts
      if (extNode.is_core) {
        ctx.strokeStyle = 'rgba(0, 122, 255, 0.3)'
        ctx.lineWidth = 1 / globalScale
        ctx.stroke()
      }

      // Draw label text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = extNode.is_core ? '#007AFF' : '#0F172A'

      // Text shadow for better readability
      ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
      ctx.shadowBlur = 4
      ctx.fillText(labelText, node.x!, node.y! + finalSize + 4 / globalScale + labelHeight / 2)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }
  }
}

export function createLinkCanvasObject(
  selectedNodeId: string | null | undefined,
  hoveredNode: ExtendedNode | null
) {
  return (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const extLink = link as ExtendedLink
    const source = link.source as NodeObject
    const target = link.target as NodeObject

    if (!source.x || !source.y || !target.x || !target.y) return

    // Get source and target colors for gradient
    const sourceNode = source as ExtendedNode
    const targetNode = target as ExtendedNode

    let sourceColor = DEFAULT_PLANET_COLOR.base
    let targetColor = DEFAULT_PLANET_COLOR.base

    if (sourceNode.is_core) sourceColor = CORE_COLOR.base
    else if (sourceNode.category && PLANET_COLORS[sourceNode.category]) {
      sourceColor = PLANET_COLORS[sourceNode.category].base
    }

    if (targetNode.is_core) targetColor = CORE_COLOR.base
    else if (targetNode.category && PLANET_COLORS[targetNode.category]) {
      targetColor = PLANET_COLORS[targetNode.category].base
    }

    // Check if link is connected to selected or hovered node
    const isHighlighted =
      selectedNodeId === sourceNode.id ||
      selectedNodeId === targetNode.id ||
      hoveredNode?.id === sourceNode.id ||
      hoveredNode?.id === targetNode.id

    // Draw cosmic connection with gradient
    const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y)
    gradient.addColorStop(0, `${sourceColor}80`)
    gradient.addColorStop(0.5, isHighlighted ? 'rgba(0, 122, 255, 0.6)' : 'rgba(150, 170, 200, 0.3)')
    gradient.addColorStop(1, `${targetColor}80`)

    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.strokeStyle = gradient
    ctx.lineWidth = isHighlighted ? 1.5 / globalScale : 0.5 / globalScale
    ctx.setLineDash(isHighlighted ? [] : [4, 4])
    ctx.stroke()
    ctx.setLineDash([])

    // Draw animated particles on highlighted links
    if (isHighlighted && globalScale >= 0.5) {
      const particleCount = 3
      const time = Date.now() / 1000

      for (let i = 0; i < particleCount; i++) {
        const t = ((time * 0.5 + i / particleCount) % 1)
        const px = source.x + (target.x - source.x) * t
        const py = source.y + (target.y - source.y) * t

        const particleGradient = ctx.createRadialGradient(px, py, 0, px, py, 4 / globalScale)
        particleGradient.addColorStop(0, 'rgba(0, 122, 255, 0.8)')
        particleGradient.addColorStop(1, 'transparent')

        ctx.beginPath()
        ctx.arc(px, py, 4 / globalScale, 0, 2 * Math.PI)
        ctx.fillStyle = particleGradient
        ctx.fill()
      }
    }

    // Draw relation type label at midpoint (only when highlighted)
    if (isHighlighted && globalScale >= 0.6 && extLink.relation_type) {
      const midX = (source.x + target.x) / 2
      const midY = (source.y + target.y) / 2
      const fontSize = Math.max(8 / globalScale, 3)

      // Background for label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.beginPath()
      ctx.roundRect(midX - 20, midY - 8, 40, 16, 4)
      ctx.fill()

      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#007AFF'
      ctx.fillText(extLink.relation_type, midX, midY)
    }
  }
}
