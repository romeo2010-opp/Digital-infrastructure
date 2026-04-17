import { useEffect, useState } from 'react'
import { motion as _motion } from 'framer-motion'

export function TypewriterText({ text, speed = 50, delay = 0, onComplete = null }) {
  const [displayedText, setDisplayedText] = useState('')
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    let timeout
    let charIndex = 0

    const typeCharacter = () => {
      if (charIndex < text.length) {
        setDisplayedText(text.substring(0, charIndex + 1))
        charIndex++
        timeout = setTimeout(typeCharacter, speed)
      } else {
        setIsComplete(true)
        onComplete?.()
      }
    }

    timeout = setTimeout(typeCharacter, delay)

    return () => clearTimeout(timeout)
  }, [text, speed, delay, onComplete])

  return (
    <span className='typewriter-text'>
      <span className='typewriter-content'>{displayedText}</span>
      {!isComplete && <span className='typewriter-cursor' />}
    </span>
  )
}
