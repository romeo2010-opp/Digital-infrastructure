import { useState } from "react"
import { useAuth } from "../auth/AuthContext"
import { useTopLoading } from "../layout/TopLoadingContext"
import "../assets/login.css"

export default function Login({ bootstrapping = false }) {
  const { login, isApiMode } = useAuth()
  const { setTopLoading } = useTopLoading()
  const [form, setForm] = useState({
    email: "",
    password: "",
  })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setError("")
    setLoading(true)
    setTopLoading("login", true)

    try {
      await login({
        email: form.email.trim() || undefined,
        password: form.password,
      })
    } catch (err) {
      setError(err.message || "Login failed")
    } finally {
      setLoading(false)
      setTopLoading("login", false)
    }
  }

  return (
    <section className="login-page">
      <article className="login-layout">
        <div className="login-card">
          <span className="login-brand-mark" aria-hidden="true">
            <img src="/smartlink-mark-tight.png" alt="" />
          </span>

          <header className="login-card-header">
            <h1>Welcome back</h1>
            <p>Log in to your SmartLink station account</p>
          </header>

          <div className="login-divider" aria-hidden="true">
            <span />
            <strong>continue with email</strong>
            <span />
          </div>

          {bootstrapping ? (
            <p className="login-note">Checking active session...</p>
          ) : null}

          <form className="login-form" onSubmit={onSubmit}>
            <label className="login-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="manager@smartlink.com"
              />
            </label>

            <label className="login-field">
              <span className="login-label-row">
                <span>Password</span>
                <button type="button" className="login-inline-action">
                  Forgot password?
                </button>
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="Enter password"
                required
              />
            </label>

            <div className="login-verification" aria-label="Verification placeholder">
              <span className="login-verification-check" aria-hidden="true" />
              <span className="login-verification-text">I&apos;m not a robot</span>
              <span className="login-captcha-mark" aria-hidden="true">
                <span />
                <small>reCAPTCHA</small>
              </span>
            </div>

            {error ? <p className="login-error">{error}</p> : null}

            {!isApiMode ? <p className="login-note">Mock mode is active. Set `VITE_DATA_SOURCE=api` for backend auth.</p> : null}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Signing in..." : "Log in"}
            </button>

            <p className="login-signup">
              First time around here?{" "}
              <button type="button">Contact administrator</button>
            </p>
          </form>
        </div>

        <aside className="login-showcase" aria-label="SmartLink station workspace">
          <img src="/login-person-laptop.png" alt="Person using a laptop" />
        </aside>
      </article>
    </section>
  )
}
