import { useEffect, useRef, useCallback } from 'react'

interface Star {
  x: number
  y: number
  size: number
  opacity: number
  twinkleSpeed: number
  twinkleOffset: number
}

interface Meteor {
  id: number
  x: number
  y: number
  delay: number
}

export function StarField({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const starsRef = useRef<Star[]>([])
  const meteorsRef = useRef<Meteor[]>([])
  const timeRef = useRef<number>(0)

  const initStars = useCallback((width: number, height: number) => {
    const stars: Star[] = []
    const starCount = Math.floor((width * height) / 3000) // Density: 1 star per 3000 pixels

    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 0.02 + 0.01,
        twinkleOffset: Math.random() * Math.PI * 2,
      })
    }
    starsRef.current = stars
  }, [])

  const initMeteors = useCallback(() => {
    const meteors: Meteor[] = []
    // Create 3 meteors with different delays
    for (let i = 0; i < 3; i++) {
      meteors.push({
        id: i,
        x: Math.random() * 0.5 + 0.3, // Start in right 50-80% of screen
        y: Math.random() * 0.3, // Start in top 30% of screen
        delay: i * 8000 + Math.random() * 5000, // Stagger timing
      })
    }
    meteorsRef.current = meteors
  }, [])

  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Draw nebula gradients
    const nebulaGradient1 = ctx.createRadialGradient(
      width * 0.2, height * 0.8, 0,
      width * 0.2, height * 0.8, height * 0.6
    )
    nebulaGradient1.addColorStop(0, 'rgba(30, 58, 95, 0.3)')
    nebulaGradient1.addColorStop(1, 'transparent')
    ctx.fillStyle = nebulaGradient1
    ctx.fillRect(0, 0, width, height)

    const nebulaGradient2 = ctx.createRadialGradient(
      width * 0.8, height * 0.2, 0,
      width * 0.8, height * 0.2, height * 0.5
    )
    nebulaGradient2.addColorStop(0, 'rgba(139, 92, 246, 0.15)')
    nebulaGradient2.addColorStop(1, 'transparent')
    ctx.fillStyle = nebulaGradient2
    ctx.fillRect(0, 0, width, height)

    // Draw twinkling stars
    timeRef.current += 0.016 // ~60fps
    starsRef.current.forEach((star) => {
      const twinkle = Math.sin(timeRef.current * star.twinkleSpeed + star.twinkleOffset)
      const opacity = star.opacity + twinkle * 0.3

      ctx.beginPath()
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(1, opacity))})`
      ctx.fill()

      // Add glow to brighter stars
      if (star.size > 1 && opacity > 0.6) {
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.size * 2, 0, Math.PI * 2)
        const glow = ctx.createRadialGradient(
          star.x, star.y, 0,
          star.x, star.y, star.size * 2
        )
        glow.addColorStop(0, `rgba(200, 220, 255, ${opacity * 0.3})`)
        glow.addColorStop(1, 'transparent')
        ctx.fillStyle = glow
        ctx.fill()
      }
    })

    // Draw meteors
    const currentTime = Date.now()
    meteorsRef.current.forEach((meteor) => {
      const cycleTime = (currentTime + meteor.delay) % 12000
      if (cycleTime > 1000 && cycleTime < 3000) {
        const progress = (cycleTime - 1000) / 2000
        const meteorX = width * meteor.x - progress * (width * 0.8)
        const meteorY = height * meteor.y + progress * (height * 0.5)
        const tailLength = 80 + progress * 40

        // Draw meteor tail
        const tailGradient = ctx.createLinearGradient(
          meteorX + tailLength, meteorY,
          meteorX, meteorY
        )
        tailGradient.addColorStop(0, 'transparent')
        tailGradient.addColorStop(0.7, 'rgba(0, 245, 255, 0.3)')
        tailGradient.addColorStop(1, 'rgba(0, 245, 255, 0.8)')

        ctx.beginPath()
        ctx.moveTo(meteorX + tailLength, meteorY)
        ctx.lineTo(meteorX, meteorY)
        ctx.strokeStyle = tailGradient
        ctx.lineWidth = 2
        ctx.stroke()

        // Draw meteor head
        ctx.beginPath()
        ctx.arc(meteorX, meteorY, 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0, 245, 255, 1)'
        ctx.fill()

        // Add glow
        ctx.beginPath()
        ctx.arc(meteorX, meteorY, 6, 0, Math.PI * 2)
        const headGlow = ctx.createRadialGradient(meteorX, meteorY, 0, meteorX, meteorY, 6)
        headGlow.addColorStop(0, 'rgba(0, 245, 255, 0.6)')
        headGlow.addColorStop(1, 'transparent')
        ctx.fillStyle = headGlow
        ctx.fill()
      }
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.clientWidth
        canvas.height = parent.clientHeight
        initStars(canvas.width, canvas.height)
        initMeteors()
      }
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const animate = () => {
      if (ctx && canvas) {
        draw(ctx, canvas.width, canvas.height)
      }
      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      cancelAnimationFrame(animationRef.current)
    }
  }, [draw, initStars, initMeteors])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ zIndex: 0 }}
    />
  )
}
