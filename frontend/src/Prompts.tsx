import { useContext, useDeferredValue, useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Plus, Search, Star, Save, Archive, Sparkles, ListPlus, WandSparkles } from 'lucide-react'
import { api, queryString } from './api'
import type { Page, Preset } from './api'
import { Busy, Empty, ErrorBox, IconButton, Modal, Notice } from './ui'
import { Composer } from './Composer'
import { AssetGrid } from './Gallery'
import { separatorError, splitPrompts } from './promptImport'
import { useDetailNavigation } from './useDetailNavigation'

function BulkPromptForm({ close }: { close: () => void }) {
  const [text, setText] = useState('')
  const [separator, setSeparator] = useState('---')
  const [category, setCategory] = useState('')
  const [titles, setTitles] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cache = useQueryClient(); const notice = useContext(Notice)
  const items = splitPrompts(text, separator).map((item, index) => ({ ...item, title: titles[index] ?? item.title, category }))
  const separatorIssue = separatorError(text, separator)
  const valid = !separatorIssue && items.length >= 2 && items.length <= 100 && items.every(item => item.text.length <= 12000 && item.title.trim().length > 0)
  return <form className="form-stack" onSubmit={async event => {
    event.preventDefault(); if (!valid || busy) return; setBusy(true); setError('')
    try { await api('/prompts/bulk', 'POST', { items }); await cache.invalidateQueries({ queryKey: ['prompts'] }); notice(`${items.length} prompt importati`); close() }
    catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }}>
    <div className="two-columns"><label>Separatore su riga dedicata<input value={separator} maxLength={80} required aria-describedby="separator-hint" onChange={event => { setSeparator(event.target.value); setTitles({}) }} /></label><label>Categoria comune<input value={category} maxLength={80} onChange={event => setCategory(event.target.value)} /></label></div>
    <small id="separator-hint">Separatore consigliato: <code>---</code>, da solo su una riga tra un prompt e il successivo.</small>
    <label>Prompt da importare<textarea rows={10} value={text} placeholder={'Primo prompt\n---\nSecondo prompt'} required aria-invalid={!!separatorIssue} aria-describedby={separatorIssue ? 'bulk-separator-error' : 'separator-hint'} maxLength={1200000} onChange={event => { setText(event.target.value); setTitles({}) }} /></label>
    {separatorIssue && <div id="bulk-separator-error"><ErrorBox error={separatorIssue} /></div>}
    {!separatorIssue && <div className="bulk-preview"><h3>{items.length} prompt</h3>{items.map((item, index) => <label key={index}>Nome {index + 1}<input required maxLength={160} value={item.title} onChange={event => setTitles(current => ({ ...current, [index]: event.target.value }))} /><small>{item.text.slice(0, 180)}</small></label>)}</div>}
    {items.length > 100 && <ErrorBox error="Massimo 100 prompt per importazione" />}{items.some(item => item.text.length > 12000) && <ErrorBox error="Un prompt supera 12000 caratteri" />}<ErrorBox error={error} /><button className="primary" disabled={!valid || busy}><ListPlus size={18} />{busy ? 'Importazione...' : `Importa ${items.length} prompt`}</button>
  </form>
}

function PromptForm({ preset, close }: { preset?: Preset; close: () => void }) {
  const [title, setTitle] = useState(preset?.title || '')
  const [text, setText] = useState(preset?.text || '')
  const [category, setCategory] = useState(preset?.category || '')
  const [tags, setTags] = useState(preset?.tags.join(', ') || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cache = useQueryClient(); const navigate = useNavigate()
  return <form className="form-stack" onSubmit={async event => {
    event.preventDefault(); setBusy(true)
    try {
      const result = await api<Preset>(preset ? `/prompts/${preset.id}` : '/prompts', preset ? 'PUT' : 'POST', { title, text, category, tags: tags.split(',').map(value => value.trim()).filter(Boolean), favorite: preset?.favorite || false, version: preset?.version })
      await cache.invalidateQueries({ queryKey: ['prompts'] }); await cache.invalidateQueries({ queryKey: ['prompt', result.id] }); close(); if (!preset) navigate(`/prompts/${result.id}`)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }}><label>Nome<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} autoFocus /></label><label>Prompt<textarea rows={10} value={text} onChange={event => setText(event.target.value)} required maxLength={12000} /></label><div className="two-columns"><label>Categoria<input value={category} onChange={event => setCategory(event.target.value)} maxLength={80} /></label><label>Tag<input value={tags} onChange={event => setTags(event.target.value)} /></label></div><ErrorBox error={error} /><button className="primary" disabled={busy}><Save size={18} />Salva prompt</button></form>
}

export function Prompts() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''; const favorite = params.get('favorite') === 'true'; const query = useDeferredValue(q)
  const [create, setCreate] = useState(false); const [compose, setCompose] = useState(false)
  const [bulk, setBulk] = useState(false)
  const presets = useInfiniteQuery({ queryKey: ['prompts', query, favorite], initialPageParam: 0, queryFn: ({ pageParam }) => api<Page<Preset>>(`/prompts?${queryString({ q: query, favorite, offset: pageParam })}`), getNextPageParam: page => page.next ?? undefined })
  const items = presets.data?.pages.flatMap(page => page.items) || []
  return <><div className="page-heading"><div><span className="eyebrow">LIBRERIA</span><h1>Prompts<span className="heading-dot coral" /></h1></div><div className="heading-actions"><button className="secondary" onClick={() => setCompose(true)}><Sparkles size={18} />Crea</button><button className="primary" onClick={() => setCreate(true)}><Plus size={18} /><span>Nuovo prompt</span></button></div></div>
    <div className="filterbar"><label className="search"><Search size={18} /><input aria-label="Cerca prompt" placeholder="Cerca nei prompt" value={q} onChange={event => setParams({ q: event.target.value, favorite: String(favorite) }, { replace: true })} /></label><IconButton label="Importa prompt" onClick={() => setBulk(true)}><ListPlus size={20} /></IconButton><IconButton label="Solo preferiti" aria-pressed={favorite} onClick={() => setParams({ q, favorite: String(!favorite) })}><Star size={20} fill={favorite ? 'currentColor' : 'none'} /></IconButton></div>
    <ErrorBox error={presets.error} />{presets.isPending ? <Busy /> : !items.length ? <Empty title="Nessun prompt"><button className="secondary" onClick={() => setCreate(true)}><Plus size={18} />Nuovo prompt</button></Empty> : <div className="prompt-list">{items.map((preset, index) => <Link className="prompt-row" to={`/prompts/${preset.id}`} key={preset.id}><span className="prompt-index">{String(index + 1).padStart(2, '0')}</span><div><div className="prompt-row-title"><h2>{preset.title}</h2>{preset.favorite && <Star size={15} fill="currentColor" />}</div><p>{preset.text}</p><div className="metadata">{preset.category && <span>{preset.category}</span>}<span>v{preset.version}</span><span>{preset.results || 0} immagini</span></div></div><ArrowUpRight size={20} /></Link>)}</div>}
    {presets.hasNextPage && <button className="secondary load-more" onClick={() => presets.fetchNextPage()}>Carica altri</button>}
    {bulk && <Modal title="Importa prompt" close={() => setBulk(false)}><BulkPromptForm close={() => setBulk(false)} /></Modal>}
    {create && <Modal title="Nuovo prompt" close={() => setCreate(false)}><PromptForm close={() => setCreate(false)} /></Modal>}{compose && <Composer operation="create" close={() => setCompose(false)} />}
  </>
}

export function PromptDetail() {
  const { id } = useParams(); const cache = useQueryClient(); const notice = useContext(Notice); const navigate = useNavigate()
  const preset = useQuery({ queryKey: ['prompt', id], queryFn: () => api<Preset>(`/prompts/${id}`) })
  const navigation = useDetailNavigation('/prompts', id, '/prompts')
  const [edit, setEdit] = useState(false); const [compose, setCompose] = useState(false); const [version, setVersion] = useState('')
  useEffect(() => { setVersion('') }, [id])
  if (preset.isPending) return <Busy />
  if (!preset.data) return <ErrorBox error={preset.error} />
  const value = preset.data
  async function favorite() { try { await api(`/prompts/${id}`, 'PUT', { ...value, favorite: !value.favorite }); cache.invalidateQueries({ queryKey: ['prompt', id] }); cache.invalidateQueries({ queryKey: ['prompts'] }) } catch (reason) { notice((reason as Error).message) } }
  const imagePicker = <Link className="secondary" to={`/originals?pick_prompt=${encodeURIComponent(value.id)}`}><WandSparkles size={18} />Modifica immagine</Link>
  return <><div className="section-toolbar"><Link className="back-link" to="/prompts"><ArrowLeft size={17} />Prompts</Link><div className="detail-navigation"><IconButton label="Prompt precedente" disabled={!navigation.hasPrevious} onClick={navigation.previous}><ChevronLeft /></IconButton><IconButton label="Prompt successivo" disabled={!navigation.hasNext} onClick={navigation.next}><ChevronRight /></IconButton></div></div><div className="page-heading"><div><span className="eyebrow">PROMPT / v{value.version}</span><h1>{value.title}</h1></div><IconButton label="Preferito" onClick={favorite}><Star fill={value.favorite ? 'currentColor' : 'none'} /></IconButton></div><div className="prompt-detail" onTouchStart={navigation.onTouchStart} onTouchEnd={navigation.onTouchEnd}><div className="section-toolbar"><select aria-label="Versione prompt" value={version} onChange={event => setVersion(event.target.value)}><option value="">Versione attuale</option>{value.versions?.map(item => <option key={item.version} value={item.version}>Versione {item.version}</option>)}</select><button className="secondary" onClick={() => setEdit(true)}><Save size={17} />Modifica</button></div><p className="prompt-text">{version ? value.versions?.find(item => String(item.version) === version)?.text : value.text}</p><div className="section-toolbar"><div className="result-actions"><button className="primary" onClick={() => setCompose(true)}><Sparkles size={18} />Crea immagine</button>{imagePicker}</div><IconButton label="Archivia prompt" onClick={async () => { if (!confirm('Archiviare il prompt? I risultati rimangono disponibili.')) return; try { await api(`/prompts/${id}`, 'DELETE'); cache.invalidateQueries({ queryKey: ['prompts'] }); navigate('/prompts') } catch (reason) { notice((reason as Error).message) } }}><Archive size={18} /></IconButton></div></div><h2 className="section-heading">Immagini generate</h2><AssetGrid key={id} filters={{ kind: 'edit', prompt_id: id }} />{edit && <Modal title="Modifica prompt" close={() => setEdit(false)}><PromptForm preset={value} close={() => setEdit(false)} /></Modal>}{compose && <Composer operation="create" prompt={value} close={() => setCompose(false)} />}</>
}