// src/components/ThreeBackground.tsx
'use client'
import { useEffect, useRef } from 'react'

export default function ThreeBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    // Adjust particle count based on device performance
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const particleCount = isMobile ? 40 : 100

    const particles: Particle[] = []
    const mouse = { x: -1000, y: -1000, radius: 150 }

    class Particle {
      x: number
      y: number
      vx: number
      vy: number
      size: number
      color: string
      baseX: number
      baseY: number
      density: number

      constructor() {
        this.x = Math.random() * width
        this.y = Math.random() * height
        // Slow drifting motion
        this.vx = (Math.random() - 0.5) * 0.4
        this.vy = (Math.random() - 0.5) * 0.4
        this.size = Math.random() * 2 + 1
        this.baseX = this.x
        this.baseY = this.y
        this.density = Math.random() * 30 + 1
        // Harmonious indigo/gray colors
        this.color = Math.random() > 0.6 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)'
      }

      update() {
        // Drifting velocity
        this.x += this.vx
        this.y += this.vy

        // Wrap around boundaries
        if (this.x < 0) this.x = width
        if (this.x > width) this.x = 0
        if (this.y < 0) this.y = height
        if (this.y > height) this.y = 0

        // Mouse attraction/repulsion force field
        const dx = mouse.x - this.x
        const dy = mouse.y - this.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance < mouse.radius) {
          const force = (mouse.radius - distance) / mouse.radius
          // Soft pull towards cursor
          const directionX = (dx / distance) * force * 1.5
          const directionY = (dy / distance) * force * 1.5
          this.x += directionX
          this.y += directionY
        }
      }

      draw() {
        if (!ctx) return
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
        ctx.fillStyle = this.color
        ctx.fill()
      }
    }

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle())
    }

    // Connect particles with thin gradient lines (constellation effect)
    function drawConnections() {
      if (!ctx) return
      const maxDistance = 120
      for (let a = 0; a < particles.length; a++) {
        for (let b = a + 1; b < particles.length; b++) {
          const dx = particles[a].x - particles[b].x
          const dy = particles[a].y - particles[b].y
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance < maxDistance) {
            const opacity = (1 - distance / maxDistance) * 0.08
            ctx.strokeStyle = `rgba(99, 102, 241, ${opacity})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(particles[a].x, particles[a].y)
            ctx.lineTo(particles[b].x, particles[b].y)
            ctx.stroke()
          }
        }
      }
    }

    // Main animation loop
    function animate() {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      
      // Ambient radial dark glow in the center
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 50,
        width / 2, height / 2, Math.max(width, height)
      )
      gradient.addColorStop(0, '#0a0a0c')
      gradient.addColorStop(1, '#020203')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      drawConnections()

      particles.forEach((p) => {
        p.update()
        p.draw()
      })

      animationFrameId = requestAnimationFrame(animate)
    }

    animate()

    // Event listeners
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }

    const handleMouseLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
    }

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }

    window.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseleave', handleMouseLeave)
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-55 pointer-events-none w-full h-full block"
    />
  )
}
