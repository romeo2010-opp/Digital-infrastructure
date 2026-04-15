import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assistantApi } from '../../mobile/api/assistantApi'
import { emitUserQueueSessionSyncFromAssistantResponse } from '../../mobile/userQueueSessionEvents'

const INITIAL_UNAVAILABLE_RESPONSE = {
  type: 'blocked',
  title: 'Assistant Unavailable',
  message: 'SmartLink Assistant needs the live SmartLink API. It is disabled in mock mode.',
  cards: [
    {
      kind: 'system_notice',
      tone: 'warning',
      title: 'Live data required',
      message: 'This feature only works with real backend data and real SmartLink actions.',
    },
  ],
  actions: [],
  suggestions: [],
  requiresConfirmation: false,
  confirmationToken: null,
  errorCode: 'assistant_api_mode_required',
}

function createUserMessage(text) {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    text: String(text || '').trim(),
  }
}

function createAssistantMessage(response) {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    response,
  }
}

function createLocalErrorResponse(error) {
  const message = String(error?.message || '').trim() || 'The SmartLink task could not be completed.'
  return {
    type: 'error',
    title: 'Action Failed',
    message,
    cards: [
      {
        kind: 'system_notice',
        tone: 'warning',
        title: 'What happened',
        message,
      },
    ],
    actions: [],
    suggestions: [],
    requiresConfirmation: false,
    confirmationToken: null,
    errorCode: 'assistant_request_failed',
  }
}

function shouldUseLocation({ message = '', actionId = '' } = {}) {
  const text = `${message} ${actionId}`.toLowerCase()
  return /(near|nearby|station|fuel|queue|reserve|reservation)/.test(text)
}

function isLocationPermissionError(error) {
  if (!error) return false
  const code = Number(error.code)
  if (code === 1) return true
  const message = String(error.message || '').toLowerCase()
  return message.includes('permission') || message.includes('denied')
}

function requestCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location services are unavailable.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
        })
      },
      (error) => {
        reject(error || new Error('Location permission was not granted.'))
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 120000,
      }
    )
  })
}

export function useAssistantSession() {
  const apiEnabled = assistantApi.isApiMode()
  const [messages, setMessages] = useState(() =>
    apiEnabled ? [] : [createAssistantMessage(INITIAL_UNAVAILABLE_RESPONSE)]
  )
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(apiEnabled)
  const [composerValue, setComposerValue] = useState('')
  const [statusNotice, setStatusNotice] = useState('')
  const [requestError, setRequestError] = useState('')
  const [locationStatus, setLocationStatus] = useState('idle')
  const locationRef = useRef(null)
  const initializedRef = useRef(false)
  const lastRequestRef = useRef(null)

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((entry) => entry.role === 'assistant') || null,
    [messages]
  )
  const latestResponse = latestAssistantMessage?.response || null
  const requiresConfirmation = Boolean(latestResponse?.requiresConfirmation)

  const resolveCurrentLocation = useCallback(async (requestShape) => {
    if (!shouldUseLocation(requestShape)) return null
    if (locationRef.current) return locationRef.current

    try {
      const location = await requestCurrentPosition()
      locationRef.current = location
      setLocationStatus('active')
      setStatusNotice('Using your current location for nearby SmartLink results.')
      return location
    } catch (error) {
      if (isLocationPermissionError(error)) {
        setLocationStatus('denied')
        setStatusNotice('Location access is off. You can still continue, or tap Use my location and allow browser permission.')
      } else {
        setLocationStatus('fallback')
        setStatusNotice('Location is not available right now. Using SmartLink station order instead.')
      }
      return null
    }
  }, [])

  const performRequest = useCallback(async (requestConfig, { appendUserText = '', remember = true } = {}) => {
    if (!apiEnabled) return

    const normalizedUserText = String(appendUserText || '').trim()
    const priorMessages = normalizedUserText ? [...messages, createUserMessage(normalizedUserText)] : messages
    if (normalizedUserText) {
      setMessages(priorMessages)
    }

    setLoading(true)
    setRequestError('')

    if (remember) {
      lastRequestRef.current = requestConfig
    }

    try {
      const currentLocation =
        requestConfig.type === 'respond'
          ? await resolveCurrentLocation({
              message: requestConfig.message,
              actionId: requestConfig.actionId,
            })
          : null

      const payload =
        requestConfig.type === 'confirm'
          ? await assistantApi.confirm({
              confirmationToken: requestConfig.confirmationToken,
            })
          : await assistantApi.respond({
              message: requestConfig.message || '',
              sessionToken: requestConfig.sessionToken || '',
              actionId: requestConfig.actionId || '',
              actionPayload: requestConfig.actionPayload || {},
              currentLocation,
            })

      const assistantResponse = payload?.response || INITIAL_UNAVAILABLE_RESPONSE

      emitUserQueueSessionSyncFromAssistantResponse(assistantResponse)
      setSession(payload?.session || null)
      setMessages((currentMessages) => {
        const baseMessages =
          normalizedUserText && currentMessages.length < priorMessages.length ? priorMessages : currentMessages
        return [...baseMessages, createAssistantMessage(assistantResponse)]
      })
    } catch (error) {
      const message = String(error?.message || '').trim() || 'The SmartLink task could not be completed.'
      setRequestError(message)
      setMessages((currentMessages) => {
        const baseMessages =
          normalizedUserText && currentMessages.length < priorMessages.length ? priorMessages : currentMessages
        return [...baseMessages, createAssistantMessage(createLocalErrorResponse(error))]
      })
    } finally {
      setLoading(false)
    }
  }, [apiEnabled, messages, resolveCurrentLocation])

  const requestLocationAccess = useCallback(async () => {
    if (!apiEnabled || loading) return

    try {
      const location = await requestCurrentPosition()
      locationRef.current = location
      setLocationStatus('active')
      setStatusNotice('Using your current location for nearby SmartLink results.')

      if (lastRequestRef.current?.type === 'respond' && shouldUseLocation(lastRequestRef.current)) {
        await performRequest(lastRequestRef.current, { remember: false })
      }
    } catch (error) {
      if (isLocationPermissionError(error)) {
        setLocationStatus('denied')
        setStatusNotice('Location permission is still blocked. Allow it in the browser, then try again.')
      } else {
        setLocationStatus('fallback')
        setStatusNotice('I still could not read your location. Using SmartLink station order instead.')
      }
    }
  }, [apiEnabled, loading, performRequest])

  useEffect(() => {
    if (!apiEnabled || initializedRef.current) return undefined
    initializedRef.current = true

    performRequest(
      {
        type: 'respond',
        message: '',
        sessionToken: '',
        actionId: '',
        actionPayload: {},
      },
      { remember: false }
    )
    return undefined
  }, [apiEnabled, performRequest])

  const sendPrompt = useCallback(async (prompt) => {
    const normalizedPrompt = String(prompt || '').trim()
    if (!normalizedPrompt || loading || !apiEnabled) return
    setComposerValue('')
    await performRequest(
      {
        type: 'respond',
        message: normalizedPrompt,
        sessionToken: session?.stateToken || '',
        actionId: '',
        actionPayload: {},
      },
      { appendUserText: normalizedPrompt }
    )
  }, [apiEnabled, loading, performRequest, session])

  const submitComposer = useCallback(async () => {
    await sendPrompt(composerValue)
  }, [composerValue, sendPrompt])

  const handleAction = useCallback(async (action) => {
    if (!action || loading || !apiEnabled) return

    if (action.kind === 'prompt') {
      await sendPrompt(action.prompt || action.label || '')
      return
    }

    if (action.kind === 'confirm') {
      await performRequest(
        {
          type: 'confirm',
          confirmationToken: action.confirmationToken,
        },
        {
          appendUserText: action.label || 'Confirm',
        }
      )
      return
    }

    await performRequest(
      {
        type: 'respond',
        message: '',
        sessionToken: session?.stateToken || '',
        actionId: action.id || '',
        actionPayload: action.payload || {},
      },
      {
        appendUserText: action.label || '',
      }
    )
  }, [apiEnabled, loading, performRequest, sendPrompt, session])

  const retryLastRequest = useCallback(async () => {
    if (!lastRequestRef.current || loading || !apiEnabled) return
    const requestConfig = lastRequestRef.current
    setRequestError('')
    await performRequest(requestConfig, { remember: false })
  }, [apiEnabled, loading, performRequest])

  const visibleSuggestions = useMemo(() => {
    if (requiresConfirmation) return []
    return Array.isArray(latestResponse?.suggestions) ? latestResponse.suggestions : []
  }, [latestResponse, requiresConfirmation])

  return {
    apiEnabled,
    composerValue,
    loading,
    locationStatus,
    messages,
    requestError,
    requiresConfirmation,
    session,
    statusNotice,
    suggestions: visibleSuggestions,
    setComposerValue,
    sendPrompt,
    submitComposer,
    handleAction,
    requestLocationAccess,
    retryLastRequest,
  }
}
