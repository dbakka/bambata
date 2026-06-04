import { useState, useEffect } from 'react'
import { getDeviceId } from '../utils/deviceId'

interface Account {
  id: string
  name: string | null
  email: string | null
  email_verified: number
}

const STORAGE_KEY = 'bambata_account'

function loadLocal(): Account | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') } catch { return null }
}
function saveLocal(a: Account) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
}

// ── small exported helper so other components can read the saved name ─────────
export function getSavedAccount(): Account | null { return loadLocal() }

// ── main component ────────────────────────────────────────────────────────────

type Step = 'idle' | 'form' | 'otp' | 'done'

interface Props {
  /** label shown in the closed nudge strip */
  nudgeLabel?: string
}

export default function ClaimAccount({ nudgeLabel = 'Save your account →' }: Props) {
  const [step, setStep] = useState<Step>('idle')
  const [account, setAccount] = useState<Account | null>(loadLocal)
  const [name, setName] = useState(account?.name ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // If already fully claimed, don't show the nudge
  const isClaimed = account?.name && account?.email && account?.email_verified

  useEffect(() => {
    if (step === 'form') setError('')
  }, [step])

  // ── save name only (no email) ────────────────────────────────────────────────
  const handleSaveName = async () => {
    if (!name.trim()) { setError('Enter your name'); return }
    setBusy(true)
    setError('')
    try {
      const deviceId = getDeviceId()
      const res = await fetch(`/api/account/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const updated = await res.json() as Account
      saveLocal(updated)
      setAccount(updated)
      setStep('done')
    } catch { setError('Something went wrong') }
    finally { setBusy(false) }
  }

  // ── send OTP ──────────────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!name.trim()) { setError('Enter your name first'); return }
    if (!email.includes('@')) { setError('Enter a valid email'); return }
    setBusy(true)
    setError('')
    try {
      const deviceId = getDeviceId()

      // Save name while we're at it
      await fetch(`/api/account/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })

      const res = await fetch(`/api/account/${deviceId}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) { const d = await res.json() as { error: string }; throw new Error(d.error) }
      const data = await res.json() as { sent: boolean; devCode?: string }
      if (data.devCode) setDevCode(data.devCode)
      setStep('otp')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to send code') }
    finally { setBusy(false) }
  }

  // ── verify OTP ───────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (code.length !== 6) { setError('Enter the 6-digit code'); return }
    setBusy(true)
    setError('')
    try {
      const deviceId = getDeviceId()
      const res = await fetch(`/api/account/${deviceId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) { const d = await res.json() as { error: string }; throw new Error(d.error) }
      const updated = await res.json() as Account
      saveLocal(updated)
      setAccount(updated)
      setStep('done')
    } catch (e) { setError(e instanceof Error ? e.message : 'Wrong code') }
    finally { setBusy(false) }
  }

  // ── already done ─────────────────────────────────────────────────────────────
  if (isClaimed) {
    return (
      <div
        className="mx-4 mt-4 px-4 py-2.5 rounded-xl flex items-center gap-3"
        style={{ background: '#0a0a0f', border: '1px solid #1e1e2e' }}
      >
        <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>✓</span>
        <span className="text-xs font-mono flex-1 truncate" style={{ color: '#475569' }}>
          {account?.name} · {account?.email}
        </span>
      </div>
    )
  }

  // ── nudge strip (closed state) ────────────────────────────────────────────────
  if (step === 'idle') {
    return (
      <button
        onClick={() => setStep('form')}
        className="mx-4 mt-4 w-[calc(100%-2rem)] px-4 py-3 rounded-xl flex items-center justify-between"
        style={{ background: '#0a0a0f', border: '1px solid #1e1e2e' }}
      >
        <div className="flex items-center gap-2.5">
          <span style={{ color: '#a78bfa', fontSize: 14 }}>◈</span>
          <span className="text-xs font-mono" style={{ color: '#64748b' }}>{nudgeLabel}</span>
        </div>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#3a3a5a' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )
  }

  // ── success ───────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div
        className="mx-4 mt-4 px-4 py-4 rounded-xl flex flex-col items-center gap-2"
        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}
      >
        <span style={{ color: '#22c55e', fontSize: 22 }}>✓</span>
        <p className="text-sm font-bold text-center" style={{ color: '#e2e8f0' }}>
          Account saved
        </p>
        {account?.email_verified ? (
          <p className="text-xs font-mono text-center" style={{ color: '#475569' }}>
            {account.email} verified · receipts on their way
          </p>
        ) : (
          <p className="text-xs font-mono text-center" style={{ color: '#475569' }}>
            Your name is saved on this device
          </p>
        )}
      </div>
    )
  }

  // ── shared inner card styles ──────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    background: '#0f0f17',
    border: '1px solid #1e1e2e',
    color: '#e2e8f0',
    fontFamily: 'system-ui',
  }

  // ── OTP step ──────────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <div
        className="mx-4 mt-4 px-4 py-5 rounded-2xl flex flex-col gap-4"
        style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
      >
        <div>
          <p className="text-xs font-mono font-bold" style={{ color: '#e2e8f0' }}>VERIFY YOUR EMAIL</p>
          <p className="text-[11px] font-mono mt-1" style={{ color: '#475569' }}>
            {devCode ? 'Email not configured yet — use this code:' : `Code sent to ${email}`}
          </p>
          {devCode && (
            <div
              className="mt-2 px-4 py-2.5 rounded-xl text-center text-xl font-mono tracking-[0.4em]"
              style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
            >
              {devCode}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-mono mb-2" style={{ color: '#475569' }}>6-DIGIT CODE</label>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="w-full px-4 py-3 rounded-xl text-center text-lg font-mono tracking-[0.4em] outline-none"
            style={inputStyle}
          />
        </div>

        {error && (
          <p className="text-[11px] font-mono" style={{ color: '#ef4444' }}>{error}</p>
        )}

        <button
          onClick={handleVerify}
          disabled={busy || code.length !== 6}
          className="w-full py-3 rounded-xl text-sm font-mono font-bold tracking-wider disabled:opacity-40"
          style={{ background: 'rgba(0,210,255,0.12)', border: '1px solid rgba(0,210,255,0.3)', color: '#00d2ff' }}
        >
          {busy ? 'VERIFYING…' : 'VERIFY'}
        </button>

        <button
          onClick={() => { setStep('form'); setCode(''); setDevCode('') }}
          className="text-center text-[10px] font-mono"
          style={{ color: '#3a3a5a' }}
        >
          ← back / resend
        </button>
      </div>
    )
  }

  // ── name + email form ─────────────────────────────────────────────────────────
  return (
    <div
      className="mx-4 mt-4 px-4 py-5 rounded-2xl flex flex-col gap-4"
      style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono font-bold" style={{ color: '#e2e8f0' }}>SAVE YOUR ACCOUNT</p>
        <button onClick={() => setStep('idle')} className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>
          ✕
        </button>
      </div>

      <div>
        <label className="block text-[10px] font-mono mb-2" style={{ color: '#475569' }}>YOUR NAME</label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What do people call you?"
          className="w-full px-4 py-3 rounded-xl text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[10px] font-mono mb-1" style={{ color: '#475569' }}>
          EMAIL <span style={{ color: '#3a3a5a' }}>(optional)</span>
        </label>
        <p className="text-[10px] font-mono mb-2" style={{ color: '#3a3a5a' }}>
          Receipts + recover your account on a new device
        </p>
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-4 py-3 rounded-xl text-sm outline-none"
          style={inputStyle}
        />
      </div>

      {error && (
        <p className="text-[11px] font-mono" style={{ color: '#ef4444' }}>{error}</p>
      )}

      <div className="flex gap-3">
        {email.includes('@') ? (
          <button
            onClick={handleSendOtp}
            disabled={busy || !name.trim()}
            className="flex-1 py-3 rounded-xl text-sm font-mono font-bold tracking-wider disabled:opacity-40"
            style={{ background: 'rgba(0,210,255,0.12)', border: '1px solid rgba(0,210,255,0.3)', color: '#00d2ff' }}
          >
            {busy ? 'SENDING…' : 'SEND CODE'}
          </button>
        ) : (
          <button
            onClick={handleSaveName}
            disabled={busy || !name.trim()}
            className="flex-1 py-3 rounded-xl text-sm font-mono font-bold tracking-wider disabled:opacity-40"
            style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
          >
            {busy ? 'SAVING…' : 'SAVE NAME'}
          </button>
        )}
      </div>
    </div>
  )
}
