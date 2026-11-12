import { useContext, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PhotoSwipe from 'photoswipe'
import { ArrowDown, ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, Download, Expand, Eye, Layers, Maximize, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, Trash2, WandSparkles, X } from 'lucide-react'
import { api, queryString } from './api'
import type { Asset, Page, Person, Tag } from './api'
import { Busy, Empty, ErrorBox, IconButton, Notice, UploadPanel } from './ui'
import { Composer } from './Composer'

type Filters = Record<string, string | boolean | undefined>

export function AssetGrid({ filters, selection, selected, onItems }: { filters: Filters; selection?: (asset: Asset) => void; selected?: Set<string>; onItems?: (items: Asset[]) => void }) {
  const [columns, setColumns] = useState(window.innerWidth < 360 ? 2 : window.innerWidth < 1000 ? 3 : 5)
  const [gridWidth, setGridWidth] = useState(Math.min(window.innerWidth - 24, 1280))
  const element = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  const key = queryString(filters)
  const query = useInfiniteQuery({ queryKey: ['assets', key], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Page<Asset>>(`/assets?${key}&offset=${pageParam}`), getNextPageParam: page => page.next ?? undefined })
  const items = query.data?.pages.flatMap(page => page.items) || []
  const rowCount = Math.ceil(items.length / columns)
  const mobile = window.innerWidth <= 700
  const rowHeight = mobile ? (gridWidth - (columns - 1) * 6) / columns + 24 : Math.min(290, (gridWidth / columns) * 1.18) + 35
  const virtual = useWindowVirtualizer({ count: rowCount, estimateSize: () => rowHeight, overscan: 3, scrollMargin: margin })
  useEffect(() => {
    function resize() { setColumns(window.innerWidth < 360 ? 2 : window.innerWidth < 1000 ? 3 : 5); setGridWidth(element.current?.clientWidth || Math.min(window.innerWidth - 24, 1280)); setMargin((element.current?.getBoundingClientRect().top || 0) + window.scrollY) }
    resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize)
  }, [query.isPending, key])
  useEffect(() => {
    if (!element.current) return
    const observer = new ResizeObserver(() => setMargin((element.current?.getBoundingClientRect().top || 0) + window.scrollY))
    const workspace = element.current.closest('main')
    if (workspace) observer.observe(workspace)
    return () => observer.disconnect()
  }, [query.isPending])
  useEffect(() => { onItems?.(items) }, [query.data])
  const rows = virtual.getVirtualItems()
  useEffect(() => { if (rows.at(-1)?.index === rowCount - 1 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage() }, [rows.at(-1)?.index, rowCount, query.hasNextPage])
  if (query.error) return <ErrorBox error={query.error} />
  if (query.isPending) return <Busy />
  if (!items.length) return <Empty title="Nessuna immagine" />
  return <div ref={element} className="gallery-grid" style={{ height: virtual.getTotalSize() }}><div className="grid-window" style={{ transform: `translateY(${(rows[0]?.start || 0) - margin}px)` }}>{rows.map(row => <div key={row.key} className="gallery-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height: rowHeight }}>{items.slice(row.index * columns, (row.index + 1) * columns).map(asset => <div className="asset-tile" key={asset.id}>
    <Link to={`/assets/${asset.id}`} className={`asset-image ${selected?.has(asset.id) ? 'selected' : ''}`} onClick={event => { if (selection) { event.preventDefault(); selection(asset) } }}><img src={asset.thumb} alt={asset.name} loading="lazy" width={asset.width} height={asset.height} /><span className="asset-badges">{asset.operation && <span>{asset.operation}</span>}{asset.favorite && <Star size={15} fill="currentColor" />}</span>{selection && <span className="select-mark">{selected?.has(asset.id) ? <Check size={18} /> : null}</span>}</Link><div className="asset-caption"><span>{asset.name}</span><small>{asset.width} x {asset.height}</small></div>
  </div>)}</div>)}</div>{query.isFetchingNextPage && <span className="grid-loading">Caricamento...</span>}</div>
}

export function Gallery({ kind }: { kind: 'original' | 'edit' }) {
  const [params, setParams] = useSearchParams()
  const [selection, setSelection] = useState(false); const [selected, setSelected] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [picked, setPicked] = useState<Asset | null>(null)
  const pickPrompt = params.get('pick_prompt') || ''
  const picker = useQuery({ queryKey: ['prompt', pickPrompt], queryFn: () => api<import('./api').Preset>(`/prompts/${pickPrompt}`), enabled: !!pickPrompt })
  const cache = useQueryClient(); const notice = useContext(Notice)
  const q = params.get('q') || ''; const query = useDeferredValue(q)
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') })
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') })
  function filter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  useEffect(() => { setSelected(new Set()); setSelection(false) }, [kind])
  useEffect(() => { const key = `scroll:${kind}`; const position = sessionStorage.getItem(key); if (position) setTimeout(() => window.scrollTo(0, Number(position)), 200); return () => { sessionStorage.setItem(key, String(window.scrollY)) } }, [kind])
  async function bulk(values: object) {
    try { await Promise.all([...selected].map(id => api(`/assets/${id}`, 'PATCH', values))); setSelected(new Set()); setSelection(false); cache.invalidateQueries({ queryKey: ['assets'] }); notice('Immagini aggiornate') } catch (reason) { notice((reason as Error).message) }
  }
  const filters = { kind, q: query, semantic: params.get('semantic') === 'true', favorite: params.get('favorite') === 'true', deleted: params.get('deleted') === 'true', person_id: params.get('person') || undefined, tag_id: params.get('tag') || undefined, operation: params.get('operation') || undefined, job_id: params.get('job') || undefined }
  const activeFilters = [filters.semantic, filters.favorite, filters.deleted, filters.person_id, filters.tag_id, filters.operation, filters.job_id].filter(Boolean).length
  return <>{pickPrompt && <div className="image-picker-banner"><div><strong>Scegli immagine</strong><small>{picker.data?.title || 'Caricamento prompt...'}</small></div><Link className="text-link" to={`/${kind === 'original' ? 'edits' : 'originals'}?pick_prompt=${encodeURIComponent(pickPrompt)}`}>{kind === 'original' ? 'Edits' : 'Originali'}</Link><Link className="icon-button" title="Annulla scelta immagine" aria-label="Annulla scelta immagine" to={`/prompts/${encodeURIComponent(pickPrompt)}`}><X size={18} /></Link><ErrorBox error={picker.error} /></div>}<div className="page-heading gallery-heading"><h1>{kind === 'original' ? 'Originali' : 'Edits'}</h1>{kind === 'edit' && !pickPrompt && <button className="primary" onClick={() => setCompose(true)}><Sparkles size={18} />Crea</button>}</div>
    <div className="gallery-controls">{kind === 'original' && <UploadPanel compact />}
      <div className="filterbar"><label className="search"><Search size={18} /><input placeholder="Cerca immagini" aria-label="Cerca immagini" value={q} onChange={event => filter('q', event.target.value)} /></label><IconButton label="Filtri e selezione" aria-expanded={filtersOpen} aria-controls="gallery-filters" aria-pressed={activeFilters > 0 || selection} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={19} />{activeFilters > 0 && <span className="count">{activeFilters}</span>}</IconButton></div>
    </div>
    {filtersOpen && <div className="gallery-filters filter-panel" id="gallery-filters"><div className="filter-actions"><button className="secondary" aria-pressed={filters.semantic} onClick={() => filter('semantic', String(!filters.semantic))}><Sparkles size={17} />Semantica</button><button className="secondary" aria-pressed={filters.favorite} onClick={() => filter('favorite', String(!filters.favorite))}><Star size={17} />Preferiti</button><button className="secondary" aria-pressed={selection} onClick={() => { setSelection(!selection); setSelected(new Set()) }}><Check size={17} />Seleziona</button></div><select aria-label="Filtra per tag" value={params.get('tag') || ''} onChange={event => filter('tag', event.target.value)}><option value="">Tutti i tag</option>{tags.data?.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><select aria-label="Filtra per persona" value={params.get('person') || ''} onChange={event => filter('person', event.target.value)}><option value="">Tutte le persone</option>{people.data?.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{kind === 'edit' && <select aria-label="Operazione" value={params.get('operation') || ''} onChange={event => filter('operation', event.target.value)}><option value="">Tutte le operazioni</option><option value="edit">Modifica</option><option value="create">Create</option><option value="upscale">Upscale</option></select>}<label className="check-label"><input type="checkbox" checked={filters.deleted} onChange={event => filter('deleted', String(event.target.checked))} />Cestino</label>{activeFilters > 0 && <button className="text-link" onClick={() => { const next = new URLSearchParams(); if (q) next.set('q', q); setParams(next, { replace: true }) }}><X size={16} />Azzera filtri</button>}</div>}
    {selection && <div className="selection-bar"><span>{selected.size} selezionate</span><IconButton label="Aggiungi ai preferiti" disabled={!selected.size} onClick={() => bulk({ favorite: true })}><Star size={18} /></IconButton>{filters.deleted ? <IconButton label="Ripristina" onClick={() => bulk({ deleted: false })}><RotateCcw size={18} /></IconButton> : <IconButton label="Sposta nel cestino" disabled={!selected.size} onClick={() => { if (confirm('Spostare le immagini selezionate nel cestino?')) bulk({ deleted: true }) }}><Trash2 size={18} /></IconButton>}</div>}
    <AssetGrid key={kind + queryString(filters)} filters={filters} selected={selected} selection={pickPrompt ? asset => { if (picker.data && !picker.data.archived) setPicked(asset) } : selection ? asset => setSelected(current => { const next = new Set(current); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next }) : undefined} />
    {picked && picker.data && <Composer key={picked.id} operation="edit" asset={picked} prompt={picker.data} close={() => setPicked(null)} />}
    {compose && <Composer operation="create" close={() => setCompose(false)} />}
  </>
}

export function AssetDetail() {
  const { id } = useParams(); const cache = useQueryClient(); const navigate = useNavigate(); const notice = useContext(Notice)
  const asset = useQuery({ queryKey: ['asset', id], queryFn: () => api<Asset>(`/assets/${id}`), refetchInterval: 3000 })
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') })
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') })
  const [composer, setComposer] = useState<{ operation: string; action?: string } | null>(null)
  const [compare, setCompare] = useState(false)
  const [analysisSubmitting, setAnalysisSubmitting] = useState(false)
  const details = useRef<HTMLDivElement>(null)
  const value = asset.data
  const siblings = useQuery({ queryKey: ['assets', 'viewer', value?.kind], enabled: !!value, queryFn: () => api<Page<Asset>>(`/assets?kind=${value?.kind}&limit=100`) })
  const nearby = siblings.data?.items || []
  const index = nearby.findIndex(item => item.id === id)
  useEffect(() => { window.scrollTo(0, 0); setCompare(false) }, [id])
  async function mutate(path: string, method: string, payload: unknown) {
    try { await api(path, method, payload); cache.invalidateQueries({ queryKey: ['asset', id] }); cache.invalidateQueries({ queryKey: ['people'] }); cache.invalidateQueries({ queryKey: ['assets'] }) } catch (reason) { notice((reason as Error).message) }
  }
  async function requestAnalysis() {
    setAnalysisSubmitting(true)
    try {
      await api(`/assets/${id}`, 'PATCH', { reanalyze: true })
      await cache.invalidateQueries({ queryKey: ['asset', id] })
      notice('Analisi accodata')
    } catch (reason) { notice((reason as Error).message) }
    finally { setAnalysisSubmitting(false) }
  }
  function zoom() {
    if (!value) return
    const items = nearby.some(item => item.id === value.id) ? nearby : [value]
    const viewer = new PhotoSwipe({ dataSource: items.map(item => ({ src: `/api/assets/${item.id}/file/original`, msrc: item.preview, width: item.width, height: item.height, alt: item.name })), index: Math.max(0, items.findIndex(item => item.id === value.id)), bgOpacity: 1, wheelToZoom: true, showAnimationDuration: 0, hideAnimationDuration: 0 })
    viewer.init()
  }
  if (asset.isPending) return <Busy />
  if (!value) return <ErrorBox error={asset.error} />
  const related = value.kind === 'original' ? { kind: 'edit', root_id: value.id } : { kind: 'edit', input_id: value.id }
  return <><section className="image-stage"><div className="stage-top"><IconButton label="Torna alla galleria" onClick={() => navigate(-1)}><ArrowLeft /></IconButton><span>{value.name}</span><IconButton label="Zoom immagine" onClick={zoom}><Expand /></IconButton></div><button className="stage-image" aria-label="Apri zoom" onClick={zoom}><img src={compare && value.input ? value.input.preview : value.preview} alt={compare ? 'Immagine di ingresso' : value.name} /></button><div className="stage-bottom"><div className="stage-navigation"><IconButton label="Immagine precedente" disabled={index <= 0} onClick={() => navigate(`/assets/${nearby[index - 1].id}`, { replace: true })}><ChevronLeft /></IconButton><small>{value.width} x {value.height}</small><IconButton label="Immagine successiva" disabled={index < 0 || index >= nearby.length - 1} onClick={() => navigate(`/assets/${nearby[index + 1].id}`, { replace: true })}><ChevronRight /></IconButton></div><button className="stage-details" onClick={() => details.current?.scrollIntoView({ behavior: 'smooth' })}>Dettagli<ArrowDown size={17} /></button></div></section>
    <div className="asset-details" ref={details}><div className="section-toolbar"><div><span className="eyebrow">{value.kind === 'original' ? 'ORIGINALE' : value.job?.operation.toUpperCase()}</span><h1>{value.kind === 'original' ? 'Da qui, nuove possibilità.' : value.job?.operation === 'create' ? 'Generata da testo' : 'Elaborazione'}</h1></div><div className="action-icons"><IconButton label="Preferito" onClick={() => mutate(`/assets/${id}`, 'PATCH', { favorite: !value.favorite })}><Star fill={value.favorite ? 'currentColor' : 'none'} /></IconButton><a className="icon-button" title="Scarica originale" aria-label="Scarica originale" href={`/api/assets/${id}/file/original?download=true`}><Download size={20} /></a><IconButton label={value.deleted ? 'Ripristina immagine' : 'Sposta nel cestino'} onClick={() => { if (value.deleted || confirm('Spostare nel cestino?')) mutate(`/assets/${id}`, 'PATCH', { deleted: !value.deleted }) }}>{value.deleted ? <RotateCcw size={20} /> : <Trash2 size={20} />}</IconButton></div></div>
      <div className="result-actions"><button className="primary" onClick={() => setComposer({ operation: 'edit' })}><WandSparkles size={18} />Modifica</button><button className="secondary" onClick={() => setComposer({ operation: 'upscale' })}><Maximize size={18} />Upscale</button>{value.job && <><button className="secondary" onClick={() => setComposer({ operation: value.job!.operation, action: 'repeat' })}><RotateCcw size={18} />Rigenera</button><button className="secondary" onClick={() => setComposer({ operation: 'edit', action: 'vary' })}><Sparkles size={18} />Variazione</button></>}{value.input && <button className="secondary" aria-pressed={compare} onClick={() => { setCompare(!compare); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Eye size={18} />{compare ? 'Risultato' : 'Confronta input'}</button>}</div>
      {(value.original || value.input) && <div className="lineage">{value.original && <Link to={`/assets/${value.original.id}`}><img src={value.original.thumb} alt="Originale iniziale" /><div><small>Originale iniziale</small><strong>{value.original.name}</strong></div><ArrowUpRight size={18} /></Link>}{value.input && value.input.id !== value.original?.id && <Link to={`/assets/${value.input.id}`}><img src={value.input.thumb} alt="Input immediato" /><div><small>Input utilizzato</small><strong>{value.input.name}</strong></div><ArrowUpRight size={18} /></Link>}</div>}
      {value.job && <section className="detail-section"><div className="section-toolbar"><h2>{value.job.operation === 'upscale' ? 'Parametri upscale' : 'Prompt utilizzato'}</h2>{value.job.instruction && <IconButton label="Copia prompt" onClick={async () => { try { await navigator.clipboard.writeText(value.job!.instruction); notice('Prompt copiato') } catch { notice('Accesso agli appunti non disponibile') } }}><Copy size={18} /></IconButton>}</div>{value.job.instruction && <p className="prompt-text">{value.job.instruction}</p>}{value.job.prompt_id && <Link className="text-link" to={`/prompts/${value.job.prompt_id}`}>Apri prompt · v{value.job.prompt_version}<ArrowUpRight size={16} /></Link>}<dl className="parameter-list"><div><dt>Seed</dt><dd>{value.job.settings.seed}</dd></div><div><dt>{value.job.operation === 'upscale' ? 'Fattore' : 'Risoluzione edit'}</dt><dd>{value.job.operation === 'upscale' ? `${value.job.settings.upscale_factor}x` : `${value.job.settings.edit_resolution} MP`}</dd></div><div><dt>LoRA</dt><dd>{value.job.settings.loras.map(item => `${item.name} (${item.weight})`).join(', ') || 'Nessuno'}</dd></div></dl></section>}
      <section className="detail-section"><div className="section-toolbar"><h2>Tag e persone</h2><button className="text-link" disabled={analysisSubmitting} onClick={requestAnalysis}><RotateCcw size={16} />{analysisSubmitting ? 'Invio...' : 'Analizza'}</button></div><span className="metadata" role="status">Analisi: {({ pending: 'In attesa del worker ML', done: 'Completata', failed: 'Non riuscita' } as Record<string, string>)[value.analysis] || value.analysis}</span>{value.analysis_error && <ErrorBox error={value.analysis_error} />}<div className="tag-list">{value.tags?.map(tag => <div className={`tag ${tag.state === 'suggested' ? 'suggested' : ''}`} key={tag.id}><span>{tag.name}</span>{tag.state === 'suggested' && <IconButton label={`Accetta ${tag.name}`} onClick={() => mutate(`/assets/${id}/tags/${tag.id}`, 'PUT', { state: 'accepted' })}><Check size={13} /></IconButton>}<IconButton label={`Rifiuta ${tag.name}`} onClick={() => mutate(`/assets/${id}/tags/${tag.id}`, 'PUT', { state: 'rejected' })}><X size={13} /></IconButton></div>)}</div><select aria-label="Aggiungi tag" value="" onChange={event => { if (event.target.value) mutate(`/assets/${id}/tags/${event.target.value}`, 'PUT', { state: 'manual' }) }}><option value="">Aggiungi tag manuale</option>{tags.data?.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
        {value.faces?.map((face, position) => <div className="face-row" key={face.id}><span>Volto {position + 1}{face.locked ? ' · confermato' : ''}</span><select aria-label={`Persona volto ${position + 1}`} value={face.person_id || ''} onChange={event => { if (event.target.value === 'new') { const name = prompt('Nome della persona'); if (name) mutate(`/faces/${face.id}`, 'PATCH', { new_person: name }) } else mutate(`/faces/${face.id}`, 'PATCH', { person_id: event.target.value || null }) }}><option value="">Non assegnato</option>{people.data?.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="new">Nuova persona...</option></select></div>)}
      </section><h2 className="section-heading">{value.kind === 'original' ? 'Tutte le elaborazioni' : 'Elaborazioni successive'}</h2><AssetGrid key={value.id} filters={related} />
    </div>{composer && <Composer asset={value} operation={composer.operation} action={composer.action} close={() => setComposer(null)} />}
  </>
}