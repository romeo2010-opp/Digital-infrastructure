import { useState } from 'react'
import { userAuthApi } from '../api/userAuthApi'
import {
  getStoredSessionMeta,
  setStoredAccessToken,
  setStoredSessionMeta,
} from '../authSession'
import { assertUserAppAccessToken, assertUserAppSessionMeta } from '../userSessionGuard'
import {
  isPasskeyAbortError,
  isPasskeySupported,
  registerCurrentDevicePasskey,
  signInWithPasskey,
} from '../passkeys'

function normalizeIdentifier(identifier) {
  const scoped = String(identifier || '').trim()
  if (!scoped) return { email: '', phone: '' }
  if (scoped.includes('@')) return { email: scoped, phone: '' }
  return { email: '', phone: scoped }
}

function toUiErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (!message) return 'Unable to sign in'
  if (/failed to fetch/i.test(message)) {
    return 'Network error: API unreachable. Check backend URL/tunnel and restart dev server.'
  }
  return message
}

export function LoginScreen({ onAuthenticated }) {
  const existingSession = getStoredSessionMeta()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [fullName, setFullName] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isUsingPasskey, setIsUsingPasskey] = useState(false)

  const completeAuthentication = async ({ accessToken, fallbackSession, finalize = true } = {}) => {
    const scopedToken = String(accessToken || '').trim()
    if (!scopedToken) throw new Error('Authentication did not return access token')
    assertUserAppAccessToken(scopedToken)

    const me = await userAuthApi.me(scopedToken)
    const sessionMeta = {
      user: me?.user || fallbackSession?.user || null,
      station: me?.station || fallbackSession?.station || null,
      role: me?.role || fallbackSession?.role || null,
      loginAt: new Date().toISOString(),
    }

    assertUserAppSessionMeta(sessionMeta)
    setStoredAccessToken(scopedToken)
    setStoredSessionMeta(sessionMeta)
    const authPayload = { accessToken: scopedToken, session: sessionMeta }
    if (finalize) {
      onAuthenticated?.(authPayload)
    }
    return authPayload
  }

  const handlePasswordLogin = async (event) => {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const identity = normalizeIdentifier(identifier)
      const loginData = await userAuthApi.login({
        email: identity.email,
        phone: identity.phone,
        password,
      })
      await completeAuthentication({
        accessToken: loginData?.accessToken,
        fallbackSession: loginData,
      })
    } catch (requestError) {
      setError(toUiErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setError('')
    setIsUsingPasskey(true)

    try {
      const loginData = await signInWithPasskey(userAuthApi)
      await completeAuthentication({
        accessToken: loginData?.accessToken,
        fallbackSession: loginData,
      })
    } catch (requestError) {
      if (isPasskeyAbortError(requestError)) {
        setError('')
      } else {
        setError(toUiErrorMessage(requestError))
      }
    } finally {
      setIsUsingPasskey(false)
    }
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()
    setError('')
    setIsCreating(true)

    try {
      const normalizedName = String(fullName || '').trim()
      if (!normalizedName) throw new Error('Full name is required')
      const normalizedPhone = String(createPhone || '').trim()
      if (!normalizedPhone) throw new Error('Phone number is required')
      if (createPassword !== confirmPassword) throw new Error('Passwords do not match')
      if (String(createPassword || '').trim().length < 5) throw new Error('Password must be at least 5 characters')

      const registerData = await userAuthApi.register({
        fullName: normalizedName,
        email: String(createEmail || '').trim(),
        phone: normalizedPhone,
        password: createPassword,
      })

      const authPayload = await completeAuthentication({
        accessToken: registerData?.accessToken,
        fallbackSession: registerData,
        finalize: false,
      })

      if (isPasskeySupported()) {
        const shouldEnrollPasskey = window.confirm(
          'Do you want to enable passkey or biometric sign-in on this device now?'
        )
        if (shouldEnrollPasskey) {
          try {
            await registerCurrentDevicePasskey(userAuthApi, {
              name: 'Primary device passkey',
            })
          } catch (passkeyError) {
            if (!isPasskeyAbortError(passkeyError)) {
              setError(toUiErrorMessage(passkeyError) || 'Account created, but passkey setup did not finish.')
            }
          }
        }
      }

      onAuthenticated?.(authPayload)
    } catch (requestError) {
      setError(toUiErrorMessage(requestError) || 'Unable to create account')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <section className='login-screen'>
      <article className='login-card'>
        <header>
          <h2>Sign in</h2>
          <p>Authenticate to enable live queue API integration.</p>
        </header>

        {existingSession?.user?.fullName ? (
          <div className='login-existing-session'>
            Last session: <strong>{existingSession.user.fullName}</strong>
          </div>
        ) : null}

        <form className='login-form' onSubmit={handlePasswordLogin}>
          <label>
            <span>Email or phone</span>
            <input
              type='text'
              autoComplete='username'
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder='name@example.com or +265...'
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder='••••••••'
              required
            />
          </label>

          <button type='submit' className='details-action-button is-primary' disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {isPasskeySupported() ? (
          <button
            type='button'
            className='details-action-button is-secondary login-passkey-button'
            disabled={isUsingPasskey}
            onClick={handlePasskeyLogin}
          >
            {isUsingPasskey ? 'Opening passkey…' : 'Sign in with Passkey'}
          </button>
        ) : null}

        <div className='login-secondary-row'>
          <span>New to SmartLink?</span>
          <button
            type='button'
            className='login-link-button'
            onClick={() => {
              setShowCreateAccount((previous) => !previous)
              setError('')
            }}
          >
            {showCreateAccount ? 'Hide create account' : 'Create account'}
          </button>
        </div>

        {showCreateAccount ? (
          <form className='login-form create-account-form' onSubmit={handleCreateAccount}>
            <label>
              <span>Full name</span>
              <input
                type='text'
                autoComplete='name'
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder='Your full name'
                required
              />
            </label>

            <label>
              <span>Phone number</span>
              <input
                type='tel'
                autoComplete='username'
                value={createPhone}
                onChange={(event) => setCreatePhone(event.target.value)}
                placeholder='+265...'
                required
              />
            </label>

            <label>
              <span>Email (optional)</span>
              <input
                type='email'
                autoComplete='email'
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
                placeholder='name@example.com'
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type='password'
                autoComplete='new-password'
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
                placeholder='Create password'
                required
              />
            </label>

            <label>
              <span>Confirm password</span>
              <input
                type='password'
                autoComplete='new-password'
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder='Repeat password'
                required
              />
            </label>

            <button type='submit' className='details-action-button is-secondary' disabled={isCreating}>
              {isCreating ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        ) : null}

        {error ? <p className='login-error'>{error}</p> : null}
      </article>
    </section>
  )
}
