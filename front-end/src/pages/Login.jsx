import { useState } from "react"
import { SmartLinkLogo } from "../utils/icons"
import { useAuth } from "../auth/AuthContext"
import "../assets/login.css"

export default function Login({ bootstrapping = false }) {
  const { login, isApiMode } = useAuth()
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

    try {
      await login({
        email: form.email.trim() || undefined,
        password: form.password,
      })
    } catch (err) {
      setError(err.message || "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="login-page">
      <article className="login-layout">
        <aside className="login-showcase">
          <header className="login-showcase-brand">
            <SmartLinkLogo />
            <div>
              <h1>SmartLink</h1>
              <p>Fuel Infrastructure Cloud</p>
            </div>
          </header>
          <div className="login-showcase-copy">
            <h2>Station Operations Suite</h2>
            <p>Manage queues, pumps, reports, and station activity from one secure dashboard.</p>
            <ul>
              <li>Live queue and reservation management</li>
              <li>Pump status controls and alerts</li>
              <li>Shift reports with audit traceability</li>
            </ul>
          </div>
        </aside>

        <div className="login-card">
          <header className="login-card-header">
            <h3>Sign In</h3>
            <p>Use your station credentials to continue.</p>
          </header>

          {bootstrapping ? (
            <p className="login-note">Checking active session...</p>
          ) : null}

          <form className="login-form" onSubmit={onSubmit}>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="manager@smartlink.com"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="Enter password"
                required
              />
            </label>

            {error ? <p className="login-error">{error}</p> : null}

            {!isApiMode ? <p className="login-note">Mock mode is active. Set `VITE_DATA_SOURCE=api` for backend auth.</p> : null}

            <button type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </article>
    </section>
  )
}
