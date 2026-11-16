import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { LockKeyhole, LogOut, Save, UnlockKeyhole } from 'lucide-react'
import { api } from './api'
import { ErrorBox } from './ui'

interface PrivacyStatus { enabled: boolean; locked: boolean }
const PrivacyContext = createContext({ enabled: false, locked: true })
export function usePrivacyEnabled() { return useContext(PrivacyContext).enabled }
export function usePrivacyLocked() { return useContext(PrivacyContext).locked }

export function PrivacyGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null)
  const [pin, setPin] = useState('')
  const [passwordMode, setPasswordMode] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const dialogs = useRef<HTMLDialogElement[]>([])
  const current = useRef(status)
  const pendingLock = useRef<Promise<unknown>>(Promise.resolve())
  const generation = useRef(0)
  const cache = useQueryClient()
  current.current = status

  useEffect(() => {
    let active = true
    let revealFrame = 0
    async function initialize() {
      try {
        const result = await api<PrivacyStatus>('/privacy')
        if (!active) return
        current.current = result
        if (result.enabled) {
          lock()
          await pendingLock.current
        }
        if (active) {
          setStatus({ enabled: result.enabled, locked: result.enabled })
          if (!result.enabled) setOpened(true)
        }
      } catch (reason) { if (active) setError((reason as Error).message) }
    }
    function lock() {
      if (!current.current?.enabled) return
      generation.current += 1
      current.current = { enabled: true, locked: true }
      setStatus(current.current)
      setPin(''); setError(''); setPasswordMode(false)
      focusManager.setFocused(false)
      document.documentElement.dataset.privacyLocked = 'true'
      for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) {
        dialogs.current.push(dialog)
        dialog.close()
      }
      pendingLock.current = api('/privacy/lock', 'POST', undefined, { keepalive: true }).catch(() => undefined)
      void cache.cancelQueries({ predicate: query => query.queryKey[0] !== 'session' })
    }
    function conceal() {
      if (!current.current?.enabled) return
      cancelAnimationFrame(revealFrame)
      document.documentElement.dataset.privacyCovered = 'true'
      flushSync(lock)
    }
    function reveal() {
      cancelAnimationFrame(revealFrame)
      if (document.hidden) return
      revealFrame = requestAnimationFrame(() => {
        if (!document.hidden) delete document.documentElement.dataset.privacyCovered
      })
    }
    function visibility() { if (document.hidden) conceal(); else reveal() }
    function changed() { setStatus(null); void initialize() }
    window.addEventListener('blur', conceal)
    window.addEventListener('focus', reveal)
    window.addEventListener('pagehide', conceal, true)
    window.addEventListener('pageshow', visibility, true)
    document.addEventListener('visibilitychange', visibility, true)
    document.addEventListener('freeze', conceal, true)
    window.addEventListener('privacy-lock', lock)
    window.addEventListener('privacy-changed', changed)
    void initialize()
    return () => {
      active = false
      generation.current += 1
      window.removeEventListener('blur', conceal)
      window.removeEventListener('focus', reveal)
      window.removeEventListener('pagehide', conceal, true)
      window.removeEventListener('pageshow', visibility, true)
      document.removeEventListener('visibilitychange', visibility, true)
      document.removeEventListener('freeze', conceal, true)
      window.removeEventListener('privacy-lock', lock)
      window.removeEventListener('privacy-changed', changed)
      cancelAnimationFrame(revealFrame)
      delete document.documentElement.dataset.privacyCovered
      delete document.documentElement.dataset.privacyLocked
      focusManager.setFocused(undefined)
    }
  }, [cache])

  useEffect(() => {
    if (!status || status.locked) return
    delete document.documentElement.dataset.privacyLocked
    focusManager.setFocused(undefined)
    for (const dialog of dialogs.current) { if (dialog.isConnected && !dialog.open) dialog.showModal() }
    dialogs.current = []
  }, [status])

  useEffect(() => {
    if (!status?.enabled || status.locked) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void api('/privacy/heartbeat', 'POST').catch(() => window.dispatchEvent(new Event('privacy-lock')))
    }, 15000)
    return () => window.clearInterval(timer)
  }, [status?.enabled, status?.locked])

  async function unlock() {
    if (busy) return
    setBusy(true); setError('')
    const request = generation.current
    try {
      await pendingLock.current
      const result = await api<PrivacyStatus>(passwordMode ? '/privacy/password' : '/privacy/unlock', 'POST', passwordMode ? { password: pin } : { pin })
      if (request !== generation.current || document.hidden) {
        await api('/privacy/lock', 'POST', undefined, { keepalive: true })
        return
      }
      setPin(''); setPasswordMode(false)
      void cache.invalidateQueries({ predicate: query => query.queryKey[0] !== 'session' })
      setOpened(true)
      setStatus(result)
    } catch (reason) { setPin(''); setError((reason as Error).message) }
    finally { setBusy(false) }
  }

  return <PrivacyContext.Provider value={{ enabled: status?.enabled || false, locked: !status || status.locked }}>
    <div className="privacy-curtain" aria-hidden="true"><LockKeyhole size={36} /></div>
    {!status || status.locked ? <main className="privacy-screen"><div className="privacy-heading"><LockKeyhole size={36} /><h1>Comfy Studio</h1><p>{status ? 'App bloccata' : 'Verifica accesso...'}</p></div>
      {status && <form className="form-stack" onSubmit={event => { event.preventDefault(); void unlock() }}>
        <label>{passwordMode ? 'Password completa' : 'PIN'}<input key={String(passwordMode)} aria-label={passwordMode ? 'Password completa' : 'PIN'} type="password" inputMode={passwordMode ? 'text' : 'numeric'} autoComplete={passwordMode ? 'current-password' : 'off'} pattern={passwordMode ? undefined : '[0-9]{6,12}'} minLength={passwordMode ? 1 : 6} maxLength={passwordMode ? 1024 : 12} required autoFocus value={pin} disabled={busy} onChange={event => setPin(event.target.value)} /></label>
        <button className="primary" disabled={busy}><UnlockKeyhole size={18} />{busy ? 'Sblocco...' : 'Sblocca'}</button>
        <button type="button" className="text-link" disabled={busy} onClick={() => { setPasswordMode(!passwordMode); setPin(''); setError('') }}>{passwordMode ? 'Usa il PIN' : 'Usa la password completa'}</button>
      </form>}
      <ErrorBox error={error} />
      {!status && error && <button className="secondary" onClick={() => location.reload()}>Riprova</button>}
      <button type="button" className="text-link" onClick={async () => { try { await api('/logout', 'POST'); cache.clear(); location.reload() } catch (reason) { setError((reason as Error).message) } }}><LogOut size={16} />Esci</button>
    </main> : null}
    {opened && <div className="privacy-content" hidden={!status || status.locked} inert={!status || status.locked}>{children}</div>}
  </PrivacyContext.Provider>
}

export function PrivacySettings() {
  const query = useQuery({ queryKey: ['privacy-settings'], queryFn: () => api<PrivacyStatus>('/privacy') })
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(disable = false) {
    if (busy) return
    setError('')
    if (!disable && pin !== confirmation) { setError('I PIN non coincidono'); return }
    setBusy(true)
    try {
      await api('/privacy', 'PUT', { password, pin: disable ? '' : pin })
      setPassword(''); setPin(''); setConfirmation('')
      window.dispatchEvent(new Event('privacy-changed'))
      await query.refetch()
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="settings-section"><h2>Blocco privacy</h2><p className="metadata">{query.data?.enabled ? 'PIN attivo su questo browser' : 'PIN non attivo su questo browser'}</p>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>Password completa<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <div className="settings-fields"><label>{query.data?.enabled ? 'Nuovo PIN (6-12 cifre)' : 'PIN (6-12 cifre)'}<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required value={pin} onChange={event => setPin(event.target.value)} /></label>
        <label>Conferma PIN<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></div>
      <ErrorBox error={error || query.error} /><div className="result-actions"><button className="primary" disabled={busy || query.isPending || !!query.error}><Save size={18} />{query.data?.enabled ? 'Cambia PIN' : 'Attiva PIN'}</button>
        {query.data?.enabled && <button type="button" className="secondary" disabled={busy || !password} onClick={() => { if (confirm('Disattivare il blocco privacy solo su questo browser?')) void save(true) }}><UnlockKeyhole size={18} />Disattiva PIN</button>}</div>
    </form></section>
}