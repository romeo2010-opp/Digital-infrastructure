import { motion as _motion, useMotionValueEvent, useScroll, useSpring } from 'framer-motion'
import { useReducedMotion } from 'framer-motion'
import { useState } from 'react'

export function ScrollProgress() {
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll()
  // Keep scroll feedback subtle and transform-only for smooth performance.
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 24,
    mass: 0.2,
  })
  const [reducedProgress, setReducedProgress] = useState(0)

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    if (!prefersReducedMotion) return
    const next = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0
    setReducedProgress(next)
  })

  if (prefersReducedMotion) {
    return (
      <div className='landing-scroll-progress' aria-hidden='true'>
        <div className='landing-scroll-progress-fill' style={{ width: `${Math.round(reducedProgress * 100)}%` }} />
      </div>
    )
  }

  return (
    <div className='landing-scroll-progress' aria-hidden='true'>
      <_motion.div className='landing-scroll-progress-fill' style={{ scaleX: smoothProgress, transformOrigin: '0% 50%' }} />
    </div>
  )
}
