import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Aperture, Images, Layers, ListOrdered, Settings2, TextCursorInput, LogIn, Menu, Sun, Moon, Monitor, LoaderCircle, CircleCheck, CircleAlert } from 'lucide-react'
import { api, setCsrf } from './api'
import type { Job } from './api'
import { Busy, ErrorBox, IconButton, Modal, Notice } from './ui'
import { AssetDetail, Gallery } from './Gallery'
import { PromptDetail, Prompts } from './Prompts'
import { Queue, SettingsPage } from './Settings'

function Login({ done }: { done: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <main className="login"><Aperture size={40} /><h1>Comfy Studio</h1><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const result = await api<{ csrf: string }>('/login', 'POST', { password }); setCsrf(result.csrf); done() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }}><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required autoFocus /></label><ErrorBox error={error} /><button className="primary" disabled={busy}><LogIn size={18} />Accedi</button></form></main>
}

export default function App() {
  const cache = useQueryClient()
  const location = useLocation()
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ csrf: string; development: boolean }>('/session'), retry: false })
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState(false)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('studio-theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    function apply() { document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme }
    apply()
    localStorage.setItem('studio-theme', theme)
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => { setMenu(false) }, [location.pathname])
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs'), enabled: !!session.data, refetchInterval: 5000 })
  useEffect(() => { if (session.data) setCsrf(session.data.csrf) }, [session.data])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    const expired = () => { cache.setQueryData(['session'], null); cache.invalidateQueries({ queryKey: ['session'] }) }
    window.addEventListener('session-expired', expired)
    return () => window.removeEventListener('session-expired', expired)
  }, [cache])
  useEffect(() => {
    if (!session.data) return
    const events = new EventSource('/api/events')
    events.addEventListener('refresh', () => { cache.invalidateQueries({ queryKey: ['jobs'] }); cache.invalidateQueries({ queryKey: ['assets'] }) })
    return () => events.close()
  }, [!!session.data, cache])
  const active = jobs.data?.filter(job => ['queued', 'running', 'submitting', 'needs_attention'].includes(job.status)).length || 0
  const processing = jobs.data?.some(job => ['running', 'submitting'].includes(job.status))
  const attention = jobs.data?.some(job => job.status === 'needs_attention')
  const statusLabel = processing ? 'Elaborazione immagini in corso' : attention ? 'Lavoro da verificare' : active ? 'Lavori in attesa' : 'Nessuna elaborazione in corso'
  if (session.isPending) return <Busy />
  if (!session.data) return <Login done={() => cache.invalidateQueries({ queryKey: ['session'] })} />
  return <Notice.Provider value={setNotice}><header className="app-header"><Link className="brand" to="/originals"><Aperture size={27} /><span>Comfy <strong>Studio</strong></span></Link><div className="header-tools"><span className={`global-job-status ${attention ? 'attention' : ''}`} role="status" aria-label={statusLabel} title={statusLabel}>{processing ? <LoaderCircle className="spin" size={15} /> : attention ? <CircleAlert size={15} /> : active ? <ListOrdered size={15} /> : <CircleCheck size={15} />}</span><Link className="icon-button queue-link" aria-label={`Coda, ${active} lavori`} title="Coda" to="/queue"><ListOrdered size={21} />{active > 0 && <span className="count">{active}</span>}</Link><IconButton label="Apri menu" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={21} /></IconButton></div></header>
    <nav className="tabs" aria-label="Navigazione principale"><NavLink to="/prompts"><TextCursorInput size={20} />Prompts</NavLink><NavLink to="/originals"><Images size={20} />Originali</NavLink><NavLink to="/edits"><Layers size={20} />Edits</NavLink></nav>
    <main className={location.pathname.startsWith('/assets/') || location.pathname.startsWith('/edits/') ? 'asset-main' : 'workspace'}><Routes><Route path="/" element={<Navigate to="/originals" replace />} /><Route path="/prompts" element={<Prompts />} /><Route path="/prompts/:id" element={<PromptDetail />} /><Route path="/originals" element={<Gallery kind="original" />} /><Route path="/edits" element={<Gallery kind="edit" />} /><Route path="/edits/:id" element={<AssetDetail />} /><Route path="/assets/:id" element={<AssetDetail />} /><Route path="/queue" element={<Queue />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/originals" replace />} /></Routes></main>
    {menu && <Modal title="Menu" close={() => setMenu(false)}><div className="app-menu"><Link to="/queue" onClick={() => setMenu(false)}><ListOrdered size={20} /><span>Coda</span><small>{active} attivi</small></Link><Link to="/settings" onClick={() => setMenu(false)}><Settings2 size={20} /><span>Impostazioni</span></Link><fieldset className="theme-picker"><legend>Aspetto</legend><div className="theme-options">{([{ value: 'light', label: 'Chiaro', icon: Sun }, { value: 'dark', label: 'Scuro', icon: Moon }, { value: 'system', label: 'Sistema', icon: Monitor }]).map(option => <button key={option.value} type="button" aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}><option.icon size={18} />{option.label}</button>)}</div></fieldset></div></Modal>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </Notice.Provider>
}