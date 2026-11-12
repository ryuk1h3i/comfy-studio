import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, WandSparkles } from 'lucide-react'
import { api, token } from './api'
import type { Asset, Job, Page, Preset, Settings } from './api'
import { ErrorBox, Modal, Notice, UploadPanel } from './ui'

export function Composer({ operation, asset, prompt, action = 'normal', close }: { operation: string; asset?: Asset; prompt?: Preset; action?: string; close: () => void }) {
  const [instruction, setInstruction] = useState('')
  const [selected, setSelected] = useState(prompt?.id || '')
  const [input, setInput] = useState(asset)
  const [factor, setFactor] = useState<number | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestToken] = useState(token)
  const presets = useQuery({ queryKey: ['prompts', 'composer'], queryFn: () => api<Page<Preset>>('/prompts?limit=100') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const choices = presets.data?.items || []
  const available = prompt && !choices.some(item => item.id === prompt.id) ? [prompt, ...choices] : choices
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && settings.data) {
      initialized.current = true
      if (!prompt && action === 'normal') setSelected(settings.data.quick_slots[settings.data.active_slot] || '')
    }
  }, [settings.data, prompt, action])
  const cache = useQueryClient()
  const notice = useContext(Notice)
  const title = action === 'repeat' ? 'Rigenera' : action === 'vary' ? 'Variazione' : operation === 'upscale' ? 'Upscale' : operation === 'edit' ? 'Modifica immagine' : 'Crea immagine'
  async function submit() {
    setBusy(true); setError('')
    try {
      await api<Job>('/jobs', 'POST', { token: requestToken, operation, input_id: input?.id || null, prompt_id: selected || null, instruction, action, settings: factor === undefined ? {} : { upscale_factor: factor } })
      await cache.invalidateQueries({ queryKey: ['jobs'] }); notice('Lavoro aggiunto alla coda'); close()
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <Modal title={title} close={close}><form className="composer" onSubmit={event => { event.preventDefault(); submit() }}>
    {input && <div className="input-summary"><img src={input.thumb} alt={input.name} /><div><strong>{input.name}</strong><small>{input.width} x {input.height}</small></div></div>}
    {operation !== 'create' && !input && <UploadPanel compact onUploaded={setInput} />}
    {action === 'normal' && operation !== 'upscale' && <label>Prompt salvato<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Nessuno</option>{available.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label>}
    {selected && action === 'normal' && <div className="prompt-preview">{available.find(preset => preset.id === selected)?.text}</div>}
    {operation !== 'upscale' && action !== 'repeat' && <label>{action === 'vary' ? 'Nuova istruzione' : selected ? 'Istruzione aggiuntiva' : 'Prompt'}<textarea rows={6} value={instruction} onChange={event => setInstruction(event.target.value)} required={!selected} maxLength={12000} autoFocus /></label>}
    {operation === 'upscale' && action !== 'repeat' && <label>Fattore upscale<select value={factor ?? ''} onChange={event => setFactor(event.target.value ? Number(event.target.value) : undefined)}><option value="">Usa fattore salvato</option>{[1, 1.5, 2, 2.5, 3, 3.5, 4].map(value => <option key={value} value={value}>{value}x</option>)}</select></label>}
    <ErrorBox error={error} /><button className="primary wide" disabled={busy}><WandSparkles size={18} />{busy ? 'Invio...' : 'Aggiungi alla coda'}<ArrowRight size={18} /></button>
  </form></Modal>
}