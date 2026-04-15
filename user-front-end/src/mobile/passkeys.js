function base64UrlToUint8Array(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return new Uint8Array()
  const padded = normalized.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=')
  const raw = window.atob(withPadding)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

function uint8ArrayToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || [])
  let raw = ''
  for (const item of bytes) raw += String.fromCharCode(item)
  return window.btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeCreationOptions(options = {}) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToUint8Array(options?.user?.id),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential) => ({
          ...credential,
          id: base64UrlToUint8Array(credential.id),
        }))
      : [],
  }
}

function decodeRequestOptions(options = {}) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((credential) => ({
          ...credential,
          id: base64UrlToUint8Array(credential.id),
        }))
      : [],
  }
}

function serializeRegistrationCredential(credential) {
  if (!credential) throw new Error('Passkey registration did not return a credential')
  const response = credential.response
  if (!response) throw new Error('Passkey registration response is missing')

  return {
    id: String(credential.id || '').trim(),
    rawId: uint8ArrayToBase64Url(new Uint8Array(credential.rawId)),
    type: String(credential.type || 'public-key').trim() || 'public-key',
    response: {
      clientDataJSON: uint8ArrayToBase64Url(new Uint8Array(response.clientDataJSON)),
      attestationObject: uint8ArrayToBase64Url(new Uint8Array(response.attestationObject)),
    },
    transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
  }
}

function serializeAuthenticationCredential(credential) {
  if (!credential) throw new Error('Passkey sign-in did not return a credential')
  const response = credential.response
  if (!response) throw new Error('Passkey sign-in response is missing')

  return {
    id: String(credential.id || '').trim(),
    rawId: uint8ArrayToBase64Url(new Uint8Array(credential.rawId)),
    type: String(credential.type || 'public-key').trim() || 'public-key',
    response: {
      clientDataJSON: uint8ArrayToBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: uint8ArrayToBase64Url(new Uint8Array(response.authenticatorData)),
      signature: uint8ArrayToBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle ? uint8ArrayToBase64Url(new Uint8Array(response.userHandle)) : '',
    },
  }
}

export function isPasskeySupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof window.navigator?.credentials?.create === 'function' &&
    typeof window.navigator?.credentials?.get === 'function'
  )
}

export function isPasskeyAbortError(error) {
  const name = String(error?.name || '').trim()
  return name === 'AbortError' || name === 'NotAllowedError' || name === 'InvalidStateError'
}

export async function registerCurrentDevicePasskey(userAuthApi, { name = 'This device' } = {}) {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported on this browser.')
  }

  const optionsPayload = await userAuthApi.beginPasskeyRegistration()
  const credential = await window.navigator.credentials.create({
    publicKey: decodeCreationOptions(optionsPayload?.publicKey || {}),
  })

  return userAuthApi.completePasskeyRegistration({
    challengeId: optionsPayload?.challengeId,
    name,
    credential: serializeRegistrationCredential(credential),
  })
}

export async function signInWithPasskey(userAuthApi) {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported on this browser.')
  }

  const optionsPayload = await userAuthApi.beginPasskeyLogin()
  const credential = await window.navigator.credentials.get({
    publicKey: decodeRequestOptions(optionsPayload?.publicKey || {}),
  })

  return userAuthApi.completePasskeyLogin({
    challengeId: optionsPayload?.challengeId,
    credential: serializeAuthenticationCredential(credential),
  })
}
