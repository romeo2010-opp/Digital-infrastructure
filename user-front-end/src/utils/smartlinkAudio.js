export const SMARTLINK_AUDIO_CUES = {
  WALLET_TRANSFER_RECEIVED: 'wallet-transfer-received',
  QUEUE_SERVED: 'queue-served',
  RESERVATION_CHECK_IN_SUCCESS: 'reservation-check-in-success',
  WALLET_TOPUP_SUCCESS: 'wallet-topup-success',
  IN_APP_NOTIFICATION: 'in-app-notification',
}

let sharedAudioContext = null

const SMARTLINK_CUE_RECIPES = {
  [SMARTLINK_AUDIO_CUES.WALLET_TRANSFER_RECEIVED]: {
    highShelfFrequency: 2400,
    highShelfGain: 5.5,
    highPassFrequency: 280,
    lowPassFrequency: 6200,
    masterPeak: 0.14,
    masterRelease: 1.18,
    tones: [
      { at: 0, frequency: 1046.5, duration: 0.34, attack: 0.028, peak: 0.34, type: 'triangle', detune: 2 },
      { at: 0.11, frequency: 1318.51, duration: 0.5, attack: 0.032, peak: 0.3, type: 'triangle', detune: -1 },
      { at: 0.12, frequency: 2637.02, duration: 0.38, attack: 0.02, peak: 0.08, type: 'sine', detune: 0 },
      { at: 0.24, frequency: 3135.96, duration: 0.3, attack: 0.018, peak: 0.05, type: 'sine', detune: 0 },
    ],
  },
  [SMARTLINK_AUDIO_CUES.QUEUE_SERVED]: {
    highShelfFrequency: 2100,
    highShelfGain: 4.2,
    highPassFrequency: 220,
    lowPassFrequency: 5200,
    masterPeak: 0.125,
    masterRelease: 1.34,
    tones: [
      { at: 0, frequency: 880, duration: 0.42, attack: 0.03, peak: 0.22, type: 'triangle', detune: 1 },
      { at: 0.1, frequency: 1174.66, duration: 0.56, attack: 0.036, peak: 0.2, type: 'triangle', detune: -2 },
      { at: 0.17, frequency: 1760, duration: 0.48, attack: 0.024, peak: 0.06, type: 'sine', detune: 4 },
      { at: 0.31, frequency: 2349.32, duration: 0.42, attack: 0.022, peak: 0.04, type: 'sine', detune: -3 },
    ],
  },
  [SMARTLINK_AUDIO_CUES.RESERVATION_CHECK_IN_SUCCESS]: {
    highShelfFrequency: 2500,
    highShelfGain: 4.8,
    highPassFrequency: 260,
    lowPassFrequency: 5800,
    masterPeak: 0.12,
    masterRelease: 1.02,
    tones: [
      { at: 0, frequency: 987.77, duration: 0.28, attack: 0.024, peak: 0.24, type: 'triangle', detune: 1 },
      { at: 0.08, frequency: 1244.51, duration: 0.32, attack: 0.026, peak: 0.22, type: 'triangle', detune: -1 },
      { at: 0.18, frequency: 1479.98, duration: 0.42, attack: 0.022, peak: 0.18, type: 'triangle', detune: 0 },
      { at: 0.2, frequency: 2489.02, duration: 0.34, attack: 0.018, peak: 0.05, type: 'sine', detune: 2 },
    ],
  },
  [SMARTLINK_AUDIO_CUES.WALLET_TOPUP_SUCCESS]: {
    highShelfFrequency: 2250,
    highShelfGain: 4.6,
    highPassFrequency: 240,
    lowPassFrequency: 5600,
    masterPeak: 0.13,
    masterRelease: 1.1,
    tones: [
      { at: 0, frequency: 784, duration: 0.3, attack: 0.024, peak: 0.22, type: 'triangle', detune: 0 },
      { at: 0.09, frequency: 1046.5, duration: 0.36, attack: 0.026, peak: 0.2, type: 'triangle', detune: 1 },
      { at: 0.21, frequency: 1567.98, duration: 0.48, attack: 0.024, peak: 0.18, type: 'triangle', detune: -2 },
      { at: 0.23, frequency: 2093, duration: 0.38, attack: 0.018, peak: 0.05, type: 'sine', detune: 1 },
    ],
  },
  [SMARTLINK_AUDIO_CUES.IN_APP_NOTIFICATION]: {
    highShelfFrequency: 2700,
    highShelfGain: 3.6,
    highPassFrequency: 320,
    lowPassFrequency: 6400,
    masterPeak: 0.085,
    masterRelease: 0.78,
    tones: [
      { at: 0, frequency: 1318.51, duration: 0.2, attack: 0.018, peak: 0.14, type: 'triangle', detune: 0 },
      { at: 0.07, frequency: 1760, duration: 0.24, attack: 0.02, peak: 0.09, type: 'sine', detune: 2 },
    ],
  },
}

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (typeof AudioContextCtor !== 'function') return null

  if (sharedAudioContext?.state === 'closed') {
    sharedAudioContext = null
  }

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor()
  }

  return sharedAudioContext
}

function scheduleTone(audioContext, destinationNode, startAt, tone) {
  const oscillator = audioContext.createOscillator()
  const toneGain = audioContext.createGain()

  oscillator.type = tone.type || 'triangle'
  oscillator.frequency.setValueAtTime(tone.frequency, startAt)
  oscillator.detune.setValueAtTime(tone.detune || 0, startAt)
  oscillator.connect(toneGain)
  toneGain.connect(destinationNode)

  toneGain.gain.setValueAtTime(0.0001, startAt)
  toneGain.gain.exponentialRampToValueAtTime(tone.peak, startAt + tone.attack)
  toneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration)

  oscillator.start(startAt)
  oscillator.stop(startAt + tone.duration + 0.04)
}

export function playSmartlinkCue(cueName) {
  try {
    const audioContext = getAudioContext()
    if (!audioContext) return

    const recipe = SMARTLINK_CUE_RECIPES[cueName] || SMARTLINK_CUE_RECIPES[SMARTLINK_AUDIO_CUES.IN_APP_NOTIFICATION]

    const startPlayback = () => {
      const now = audioContext.currentTime
      const masterGain = audioContext.createGain()
      const highShelf = audioContext.createBiquadFilter()
      const highPass = audioContext.createBiquadFilter()
      const lowPass = audioContext.createBiquadFilter()

      highShelf.type = 'highshelf'
      highShelf.frequency.setValueAtTime(recipe.highShelfFrequency, now)
      highShelf.gain.setValueAtTime(recipe.highShelfGain, now)

      highPass.type = 'highpass'
      highPass.frequency.setValueAtTime(recipe.highPassFrequency, now)

      lowPass.type = 'lowpass'
      lowPass.frequency.setValueAtTime(recipe.lowPassFrequency, now)
      lowPass.Q.setValueAtTime(0.9, now)

      masterGain.connect(highShelf)
      highShelf.connect(highPass)
      highPass.connect(lowPass)
      lowPass.connect(audioContext.destination)

      masterGain.gain.setValueAtTime(0.0001, now)
      masterGain.gain.exponentialRampToValueAtTime(recipe.masterPeak, now + 0.06)
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + recipe.masterRelease)

      recipe.tones.forEach((tone) => {
        scheduleTone(audioContext, masterGain, now + tone.at, tone)
      })
    }

    if (audioContext.state === 'suspended') {
      const resumePromise = audioContext.resume()
      if (resumePromise && typeof resumePromise.then === 'function') {
        resumePromise.then(startPlayback).catch(() => {})
      }
      return
    }

    startPlayback()
  } catch {
    // Keep UI flow resilient if audio is unavailable or blocked.
  }
}
