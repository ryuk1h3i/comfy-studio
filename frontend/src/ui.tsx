import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { X, LoaderCircle, AlertCircle, ImagePlus, ClipboardPaste, Upload, Camera } from 'lucide-react'
import { api } from './api'
import type { Asset, Person } from './api'
import { useQueryClient } from '@tanstack/react-query'

export const Notice = createContext<(text: string) => void>(() => {})
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" title={label} aria-label={label} className="icon-button" {...props}>{children}</button>
}
export function Busy() { return <div className="busy" role="status"><LoaderCircle className="spin" size={24} /><span>Caricamento</span></div> }
export function ErrorBox({ error }: { error: unknown }) { return error ? <div className="error" role="alert"><AlertCircle size={18} /><span>{error instanceof Error ? error.message : String(error)}</span></div> : null }
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = '' }
  }, [])
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === dialog.current) close() }}><div className="modal-header"><h2>{title}</h2><IconButton label="Chiudi" onClick={close}><X /></IconButton></div>{children}</dialog>
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><ImagePlus size={36} strokeWidth={1.3} /><h2>{title}</h2>{children}</div> }

export function PersonNameDialog({ initialName, people, save, close }: { initialName: string; people: Person[]; save: (name: string) => Promise<void>; close: () => void }) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="Nome della persona" close={close}><form className="form-stack" onSubmit={async event => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    try { await save(name.trim()); close() }
    catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }}><label>Nome<input autoFocus required maxLength={100} list="person-name-options" value={name} onChange={event => setName(event.target.value)} /></label><datalist id="person-name-options">{Array.from(new Set(people.map(person => person.name))).sort((first, second) => first.localeCompare(second, 'it', { sensitivity: 'base' })).map(value => <option key={value} value={value} />)}</datalist><ErrorBox error={error} /><button className="primary" disabled={busy || !name.trim()}>{busy ? 'Salvataggio...' : 'Salva'}</button></form></Modal>
}

interface PendingFile { file: File; url: string; error?: string; done?: boolean }
export function UploadPanel({ onUploaded, compact = false }: { onUploaded?: (asset: Asset) => void; compact?: boolean }) {
  const [files, setFiles] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const uploadMenu = useRef<HTMLDetailsElement>(null)
  const urls = useRef<string[]>([])
  const cache = useQueryClient()
  const notice = useContext(Notice)
  useEffect(() => {
    function dismiss(event: PointerEvent) { if (uploadMenu.current && !uploadMenu.current.contains(event.target as Node)) uploadMenu.current.open = false }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [])
  function choose(action: () => void) { if (uploadMenu.current) uploadMenu.current.open = false; action() }
  function add(incoming: File[]) {
    const images = incoming.filter(file => file.type.startsWith('image/'))
    if (!images.length) { setError('Negli appunti non ci sono immagini utilizzabili.'); return }
    setError('')
    const next = images.map(file => {
      const url = URL.createObjectURL(file); urls.current.push(url)
      return { file, url, error: file.size > 19 * 1024 * 1024 ? 'Il file supera 19 MB' : undefined }
    })
    setFiles(previous => [...previous, ...next])
  }
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      const element = event.target as HTMLElement
      if (element.closest('input, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]')) return
      const incoming = Array.from(event.clipboardData?.items || []).filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file)
      if (incoming.length) { event.preventDefault(); add(incoming) }
    }
    window.addEventListener('paste', paste)
    return () => { window.removeEventListener('paste', paste); urls.current.forEach(url => URL.revokeObjectURL(url)) }
  }, [])
  async function clipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error('Clipboard non disponibile: usa il selettore file o la fotocamera.')
      const items = await navigator.clipboard.read()
      const images: File[] = []
      for (const item of items) {
        const type = item.types.find(value => value.startsWith('image/'))
        if (type) images.push(new File([await item.getType(type)], `clipboard-${Date.now()}.png`, { type }))
      }
      add(images)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Accesso agli appunti negato') }
  }
  async function upload() {
    setBusy(true)
    let completed = 0
    const next = [...files]
    for (let index = 0; index < next.length; index++) {
      const item = next[index]
      if (item.done || item.file.size > 19 * 1024 * 1024) continue
      setProgress(`${index + 1} / ${next.length}`)
      try {
        const data = new FormData(); data.append('file', item.file)
        const asset = await api<Asset>('/assets', 'POST', data)
        item.done = true; item.error = undefined; completed++; onUploaded?.(asset)
      } catch (reason) { item.error = String(reason instanceof Error ? reason.message : reason) }
      setFiles([...next])
    }
    setBusy(false); setProgress(''); setFiles(next.filter(item => !item.done))
    await cache.invalidateQueries({ queryKey: ['assets'] })
    if (completed) notice(`${completed} ${completed === 1 ? 'immagine caricata' : 'immagini caricate'}`)
  }
  return <section className={`upload-panel ${compact ? 'compact' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)) }}>
    <input hidden ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { add(Array.from(event.target.files || [])); event.target.value = '' }} />
    <input hidden ref={camera} type="file" accept="image/*" capture="environment" onChange={event => { add(Array.from(event.target.files || [])); event.target.value = '' }} />
    {compact ? <details className="upload-dropdown" ref={uploadMenu} onKeyDown={event => { if (event.key === 'Escape' && uploadMenu.current) { uploadMenu.current.open = false; uploadMenu.current.querySelector('summary')?.focus() } }}><summary className="icon-button primary" title="Aggiungi immagini" aria-label="Aggiungi immagini"><ImagePlus size={19} /></summary><div className="upload-menu"><button type="button" onClick={() => choose(() => input.current?.click())}><ImagePlus size={18} />Carica foto</button><button type="button" onClick={() => choose(clipboard)}><ClipboardPaste size={18} />Incolla immagine</button><button type="button" onClick={() => choose(() => camera.current?.click())}><Camera size={18} />Fotocamera</button></div></details> : <div className="upload-actions"><button className="primary" title="Carica foto" aria-label="Carica foto" onClick={() => input.current?.click()}><ImagePlus size={18} /><span className="upload-button-text">Carica foto</span></button><IconButton label="Incolla immagine" onClick={clipboard}><ClipboardPaste size={20} /></IconButton><IconButton label="Fotocamera" onClick={() => camera.current?.click()}><Camera size={20} /></IconButton></div>}
    <ErrorBox error={error} />
    {files.length > 0 && <div className="upload-review"><div className="upload-previews">{files.map((item, index) => <div key={item.url}><img src={item.url} alt={item.file.name} /><IconButton label="Rimuovi upload" disabled={busy} onClick={() => setFiles(current => current.filter((_, position) => position !== index))}><X size={14} /></IconButton>{item.error && <small className="error-text">{item.error}</small>}</div>)}</div><button className="primary" onClick={upload} disabled={busy}><Upload size={18} />{busy ? `Caricamento ${progress}` : `Conferma caricamento (${files.length})`}</button></div>}
  </section>
}