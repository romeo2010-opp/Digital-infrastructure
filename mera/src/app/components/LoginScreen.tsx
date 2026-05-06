import { useState } from 'react'
import { Check, Shield } from 'lucide-react'
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
    <main className="min-h-screen bg-[#f4f5f7] px-6 py-8 lg:px-10 lg:py-10">
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-[110rem] overflow-hidden rounded-[2rem] bg-white shadow-[0_18px_60px_-36px_rgba(15,23,42,0.25)] lg:grid-cols-[minmax(24rem,30rem)_1fr]">
        <div className="flex items-center px-8 py-10 sm:px-12 lg:px-16">
          <div className="w-full max-w-[25rem]">
            <div className="mb-8 inline-flex size-12 items-center justify-center rounded-2xl bg-[#83e3e2] text-white">
              <Shield className="size-5" />
            </div>
            <h1 className="text-[2.25rem] font-semibold tracking-[-0.03em] text-slate-800">Welcome back</h1>
            <p className="mt-3 text-lg text-slate-500">Log in to your MERA operations account</p>

            <div className="my-10 flex items-center gap-5 text-sm font-medium text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              <span>continue with email</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form
              className="grid gap-6"
              onSubmit={(event) => {
                event.preventDefault()
                onLogin({ email, password })
              }}
            >
              <div className="grid gap-2">
                <label className="text-base font-medium text-slate-700">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="h-12 rounded-xl border-slate-200 bg-[#eef4ff] px-4 text-slate-700 shadow-none"
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-base font-medium text-slate-700">Password</label>
                  <button type="button" className="text-base text-slate-500 transition-colors hover:text-slate-700">
                    Forgot password?
                  </button>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="h-12 rounded-xl border-slate-200 bg-[#eef4ff] px-4 text-slate-700 shadow-none"
                />
              </div>

              <div className="rounded-xl border border-slate-300 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600">
                      <Check className="size-4" />
                    </div>
                    <div className="text-base text-slate-700">I&apos;m not a robot</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-500">CAPTCHA</div>
                    <div className="text-[11px] text-slate-400">wired later</div>
                  </div>
                </div>
              </div>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <Button type="submit" className="h-12 w-full rounded-xl bg-[#2f3136] text-base font-medium text-white shadow-none hover:bg-[#24262a]" disabled={loading}>
                {loading ? 'Signing in...' : 'Log in'}
              </Button>

              <p className="text-center text-base text-slate-500">
                First time around here?{' '}
                <button type="button" className="font-semibold text-slate-800 underline underline-offset-4">
                  Contact administrator
                </button>
              </p>
            </form>
          </div>
        </div>

        <div className="hidden p-4 lg:block">
          <div className="relative flex h-full min-h-[42rem] items-center justify-center overflow-hidden rounded-[1.6rem] bg-[#1f2024]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_28%,rgba(56,189,248,0.16),transparent_18%),radial-gradient(circle_at_70%_62%,rgba(34,197,94,0.08),transparent_18%)]" />
            <div className="relative flex h-[38rem] w-[26rem] items-end justify-center">
              <div className="absolute top-12 right-8 h-24 w-24 rounded-full border border-white/6 bg-white/4 blur-2xl" />
              <div className="absolute bottom-16 left-0 h-24 w-24 rounded-full border border-cyan-400/10 bg-cyan-400/8 blur-2xl" />
              <div className="absolute top-0 flex h-28 w-20 items-center justify-center rounded-t-[2.5rem] rounded-b-[1.5rem] bg-linear-to-b from-[#b9865f] to-[#8d6040] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)]">
                <div className="absolute top-8 left-4 size-2.5 rounded-full bg-slate-900" />
                <div className="absolute top-8 right-4 size-2.5 rounded-full bg-slate-900" />
                <div className="absolute top-[3.2rem] h-4 w-10 rounded-b-full border-4 border-slate-950 border-t-0" />
              </div>
              <div className="absolute top-[5.4rem] h-[18rem] w-[14rem] rounded-[3rem] bg-linear-to-b from-[#37d6d3] to-[#18aeb1] shadow-[0_35px_60px_-28px_rgba(34,211,238,0.45)]" />
              <div className="absolute top-[7rem] -left-2 h-44 w-8 rotate-[10deg] rounded-full bg-linear-to-b from-[#a5714d] to-[#7e5337]" />
              <div className="absolute top-[7rem] -right-2 h-40 w-8 -rotate-[24deg] rounded-full bg-linear-to-b from-[#a5714d] to-[#7e5337]" />
              <div className="absolute top-[15rem] left-[5.8rem] h-[14rem] w-10 rounded-full bg-linear-to-b from-[#2cb6d1] to-[#1990c5]" />
              <div className="absolute top-[15rem] right-[5.8rem] h-[14rem] w-10 rounded-full bg-linear-to-b from-[#2cb6d1] to-[#1990c5]" />
              <div className="absolute inset-x-0 bottom-0 mx-auto h-10 w-44 rounded-full bg-cyan-300/12 blur-xl" />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
