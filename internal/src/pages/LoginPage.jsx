import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"

const NETWORK_POINT_COUNT = 200
const NETWORK_LINK_DISTANCE = 230

function buildNetworkPoints(width, height) {
  return Array.from({ length: NETWORK_POINT_COUNT }, () => {
    const highlight = Math.random() > 0.82
    const radius = highlight ? 2.6 + Math.random() * 2.4 : 1 + Math.random() * 1.6
    const speed = 1 + Math.random() * 0.24

    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
      radius,
      opacity: highlight ? 0.62 + Math.random() * 0.24 : 0.2 + Math.random() * 0.24,
      glow: highlight,
      phase: Math.random() * Math.PI * 2,
    }
  })
}

export default function LoginPage() {
  const { login } = useInternalAuth()
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0, active: false })
  const [form, setForm] = useState({ email: "", password: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const context = canvas.getContext("2d")
    if (!context) return undefined
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    let animationFrameId = 0
    let width = 0
    let height = 0
    let points = []
    let dpr = 1
    const pointer = pointerRef.current

    function resize() {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      points = buildNetworkPoints(width, height)
    }

    function drawFrame(time) {
      context.clearRect(0, 0, width, height)

      const floorGlow = context.createLinearGradient(0, height * 0.45, 0, height)
      floorGlow.addColorStop(0, "rgba(12, 55, 118, 0)")
      floorGlow.addColorStop(1, "rgba(22, 212, 248, 0.2)")
      context.fillStyle = floorGlow
      context.fillRect(0, 0, width, height)

      for (const point of points) {
        point.x += point.vx
        point.y += point.vy

        if (point.x < -36) point.x = width + 36
        if (point.x > width + 36) point.x = -36
        if (point.y < -36) point.y = height + 36
        if (point.y > height + 36) point.y = -36
      }

      const projectedPoints = points.map((point) => {
        let x = point.x
        let y = point.y
        let highlightBoost = 0

        if (pointer.active) {
          const parallaxX = ((pointer.x / width) - 0.5) * 16
          const parallaxY = ((pointer.y / height) - 0.5) * 12
          x += parallaxX
          y += parallaxY

          const dx = x - pointer.x
          const dy = y - pointer.y
          const distance = Math.hypot(dx, dy) || 1
          const interactionRadius = 190

          if (distance < interactionRadius) {
            const influence = (1 - distance / interactionRadius) ** 1.8
            x += (dx / distance) * influence * 32
            y += (dy / distance) * influence * 24
            highlightBoost = influence * 0.4
          }
        }

        return {
          ...point,
          renderX: x,
          renderY: y,
          highlightBoost,
        }
      })

      for (let index = 0; index < projectedPoints.length; index += 1) {
        const point = projectedPoints[index]
        for (let inner = index + 1; inner < projectedPoints.length; inner += 1) {
          const target = projectedPoints[inner]
          const dx = target.renderX - point.renderX
          const dy = target.renderY - point.renderY
          const distance = Math.hypot(dx, dy)
          if (distance > NETWORK_LINK_DISTANCE) continue

          const intensity = (1 - distance / NETWORK_LINK_DISTANCE) ** 1.7
          const hoverBoost = Math.max(point.highlightBoost, target.highlightBoost)
          context.beginPath()
          context.moveTo(point.renderX, point.renderY)
          context.lineTo(target.renderX, target.renderY)
          context.strokeStyle = `rgba(64, 202, 255, ${0.04 + intensity * 0.34 + hoverBoost * 0.22})`
          context.lineWidth = point.glow || target.glow ? 1.05 + hoverBoost * 0.6 : 0.72 + hoverBoost * 0.48
          context.stroke()
        }
      }

      for (const point of projectedPoints) {
        const pulse = 0.82 + Math.sin(time * 0.0012 + point.phase) * 0.18
        const radius = point.radius * pulse

        if (point.glow) {
          const glow = context.createRadialGradient(point.renderX, point.renderY, 0, point.renderX, point.renderY, radius * 8.5)
          glow.addColorStop(0, `rgba(194, 240, 255, ${point.opacity + point.highlightBoost * 0.42})`)
          glow.addColorStop(0.28, `rgba(82, 205, 255, ${point.opacity * 0.8 + point.highlightBoost * 0.34})`)
          glow.addColorStop(1, "rgba(82, 205, 255, 0)")
          context.fillStyle = glow
          context.beginPath()
          context.arc(point.renderX, point.renderY, radius * 8.5, 0, Math.PI * 2)
          context.fill()
        }

        context.fillStyle = point.glow
          ? `rgba(235, 251, 255, ${Math.min(point.opacity + 0.16 + point.highlightBoost * 0.34, 0.98)})`
          : `rgba(123, 220, 255, ${point.opacity + point.highlightBoost * 0.24})`
        context.beginPath()
        context.arc(point.renderX, point.renderY, radius + point.highlightBoost * 1.4, 0, Math.PI * 2)
        context.fill()
      }

      if (!prefersReducedMotion) {
        animationFrameId = window.requestAnimationFrame(drawFrame)
      }
    }

    resize()
    if (prefersReducedMotion) {
      drawFrame(0)
    } else {
      animationFrameId = window.requestAnimationFrame(drawFrame)
    }
    window.addEventListener("resize", resize)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener("resize", resize)
    }
  }, [])

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    pointerRef.current.x = event.clientX - bounds.left
    pointerRef.current.y = event.clientY - bounds.top
    pointerRef.current.active = true
  }

  function handlePointerLeave() {
    pointerRef.current.active = false
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      await login(form)
      navigate("/", { replace: true })
    } catch (err) {
      setError(err?.message || "Unable to sign in")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
      <canvas ref={canvasRef} className="login-network-canvas" aria-hidden="true" />
      <div className="login-screen-glow" aria-hidden="true" />

      <form className="login-card login-card--centered" onSubmit={handleSubmit}>
        <div className="login-card-header">
          <span className="login-card-kicker">Internal Sign-In</span>
          <h2>SmartLink Internal</h2>
          <p>Internal staff access for operations, oversight, and governance.</p>
        </div>

        <label className="login-field">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            placeholder="owner@smartlink.internal"
            autoComplete="username"
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="Enter password"
            autoComplete="current-password"
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button type="submit" className="primary-action login-submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in to Internal"}
        </button>

        <div className="login-card-footer">
          <div className="login-security-pill">
            <span className="login-security-dot" />
            <span>Protected internal session</span>
          </div>
        </div>
      </form>
    </div>
  )
}
