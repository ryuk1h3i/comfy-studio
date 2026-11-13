import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, WandSparkles } from 'lucide-react'
import { api, token } from './api'
import type { Asset, Job, Page, Preset, Settings } from './api'
import { ErrorBox, Modal, Notice, UploadPanel } from './ui'

export function Composer({ operation, asset, prompt, inputIds, onQueued, action = 'normal', close }: { operation: string; asset?: Asset; prompt?: Preset; inputIds?: string[]; onQueued?: (identities: string[]) => void; action?: string; close: () => void }) {
  const [instruction, setInstruction] = useState('')
  const [selected, setSelected] = useState<string[]>(prompt ? [prompt.id] : [])
  const [input, setInput] = useState(asset)
  const [factor, setFactor] = useState<number | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestTokens = useRef(new Map<string, string>())
  const [batchIds] = useState(inputIds)
  const submitted = useRef(new Set<string>())
  const [queuedCount, setQueuedCount] = useState(0)
  const presets = useQuery({ queryKey: ['prompts', 'composer'], queryFn: () => api<Page<Preset>>('/prompts?limit=100') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  const choices = presets.data?.items || []
  const available = prompt && !choices.some(item => item.id === prompt.id) ? [prompt, ...choices] : choices
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && settings.data) {
      initialized.current = true
      const defaultPrompt = settings.data.quick_slots[settings.data.active_slot]
      if (!prompt && action === 'normal') setSelected(defaultPrompt ? [defaultPrompt] : [])
    }
  }, [settings.data, prompt, action])
  const cache = useQueryClient()
  const notice = useContext(Notice)
  const multiplePrompts = operation === 'edit' && action === 'normal'
  const promptIds = action === 'normal' && operation !== 'upscale' && selected.length ? selected : [null]
  const jobCount = (batchIds?.length ?? 1) * promptIds.length
  function selectPrompts(identities: string[]) { initialized.current = true; setSelected(identities) }
  const title = action === 'repeat' ? 'Rigenera' : action === 'vary' ? 'Variazione' : operation === 'upscale' ? 'Upscale' : operation === 'edit' ? 'Modifica immagine' : 'Crea immagine'
  async function submit() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const inputs = batchIds || [input?.id || null]
      for (const identity of inputs) {
        for (const promptId of promptIds) {
          const key = JSON.stringify([identity, promptId])
          if (submitted.current.has(key)) continue
          if (!requestTokens.current.has(key)) requestTokens.current.set(key, token())
          await api<Job>('/jobs', 'POST', { token: requestTokens.current.get(key)!, operation, input_id: identity, prompt_id: promptId, instruction, action, settings: factor === undefined ? {} : { upscale_factor: factor } })
          submitted.current.add(key); setQueuedCount(submitted.current.size)
        }
        if (identity) onQueued?.([identity])
      }
      notice(jobCount > 1 ? `${jobCount} lavori aggiunti alla coda` : 'Lavoro aggiunto alla coda'); close()
    } catch (reason) { setError(`${jobCount > 1 ? `${submitted.current.size} di ${jobCount} accodate. ` : ''}${(reason as Error).message}`) } finally { await cache.invalidateQueries({ queryKey: ['jobs'] }); setBusy(false) }
  }
  return <Modal title={title} close={close}><form className="composer" onSubmit={event => { event.preventDefault(); submit() }}>
    <fieldset className="composer-fields" disabled={busy || queuedCount > 0}>
    {batchIds && <strong>{batchIds.length} immagini selezionate{queuedCount > 0 ? `, ${queuedCount} accodate` : ''}</strong>}
    {input && <div className="input-summary"><img src={input.thumb} alt={input.name} /><div><strong>{input.name}</strong><small>{input.width} x {input.height}</small></div></div>}
    {operation !== 'create' && !input && !batchIds && <UploadPanel compact onUploaded={setInput} />}
    {multiplePrompts ? <fieldset className="prompt-picker"><legend>Prompt salvati ({selected.length})</legend><div className="prompt-picker-list">{available.map(preset => <label className="check-label" key={preset.id}><input type="checkbox" checked={selected.includes(preset.id)} onChange={event => selectPrompts(event.target.checked ? [...selected, preset.id] : selected.filter(identity => identity !== preset.id))} /><span>{preset.title}</span></label>)}</div><ErrorBox error={presets.error} /></fieldset> : action === 'normal' && operation !== 'upscale' && <label>Prompt salvato<select value={selected[0] || ''} onChange={event => selectPrompts(event.target.value ? [event.target.value] : [])}><option value="">Nessuno</option>{available.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label>}
    {action === 'normal' && selected.map(identity => { const preset = available.find(item => item.id === identity); return preset && <div className="prompt-preview" key={identity}>{selected.length > 1 && <strong>{preset.title}<br /></strong>}{preset.text}</div> })}
    {operation !== 'upscale' && action !== 'repeat' && <label>{action === 'vary' ? 'Nuova istruzione' : selected.length ? 'Istruzione aggiuntiva' : 'Prompt'}<textarea rows={6} value={instruction} onChange={event => setInstruction(event.target.value)} required={!selected.length} maxLength={12000} autoFocus /></label>}
    {operation === 'upscale' && action !== 'repeat' && <label>Fattore upscale<select value={factor ?? ''} onChange={event => setFactor(event.target.value ? Number(event.target.value) : undefined)}><option value="">Usa fattore salvato</option>{[1, 1.5, 2, 2.5, 3, 3.5, 4].map(value => <option key={value} value={value}>{value}x</option>)}</select></label>}
    </fieldset>
    {jobCount > 1 && <strong>{jobCount} lavori{queuedCount > 0 ? `, ${queuedCount} accodati` : ''}</strong>}
    <ErrorBox error={error} /><button className="primary wide" disabled={busy}><WandSparkles size={18} />{busy ? 'Invio...' : 'Aggiungi alla coda'}<ArrowRight size={18} /></button>
  </form></Modal>
}