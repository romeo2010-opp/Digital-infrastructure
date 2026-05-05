import { useState } from 'react'
import { Shield } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function LoginScreen({
  onLogin,
  loading,
  error,
}: {
  onLogin: (credentials: { email: string; password: string }) => void
  loading: boolean
  error: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f8] px-6">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="mb-4 inline-flex size-11 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700">
            <Shield className="size-5" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">MERA Enforcement Portal</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in to the regulatory enforcement workstation.
          </p>
        </div>
        <form
          className="grid gap-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault()
            onLogin({ email, password })
          }}
        >
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Email</label>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Password</label>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" className="w-full bg-blue-700 hover:bg-blue-800" disabled={loading}>
            {loading ? 'Signing in...' : 'Enter Portal'}
          </Button>
        </form>
      </section>
    </main>
  )
}
