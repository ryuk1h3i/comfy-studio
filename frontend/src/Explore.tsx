import { useContext, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Pencil, ScanFace, Tags } from 'lucide-react'
import { api, queryString } from './api'
import type { Person, Tag } from './api'
import { AssetGrid } from './Gallery'
import { ErrorBox, IconButton, Notice, PersonNameDialog } from './ui'

export function Explore() {
  const [params, setParams] = useSearchParams()
  const cache = useQueryClient()
  const notice = useContext(Notice)
  const [renaming, setRenaming] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Person | null>(null)
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people'), refetchInterval: 10000 })
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags'), refetchInterval: 10000 })
  const mode = params.get('mode') === 'tags' ? 'tags' : 'faces'
  const kind = params.get('kind') || 'all'
  const person = params.get('person') || 'any'
  const tag = params.get('tag') || 'any'
  const suggested = params.get('suggested') !== 'false'
  const selectedPerson = people.data?.find(item => item.id === person)
  async function renamePerson(name: string) {
    if (!renameTarget) return
    setRenaming(true)
    try {
      const result = await api<{ id: string }>(`/people/${renameTarget.id}`, 'PATCH', { name })
      filter('person', result.id)
      await cache.invalidateQueries({ queryKey: ['people'] })
      await cache.invalidateQueries({ queryKey: ['assets'] })
      notice('Persona rinominata')
    }
    finally { setRenaming(false) }
  }
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }
  const filters = {
    kind,
    person_id: mode === 'faces' ? person : undefined,
    tag_id: mode === 'tags' ? tag : undefined,
    include_suggested: mode === 'tags' && suggested,
  }
  return <>
    <div className="page-heading gallery-heading"><h1>Volti e tag</h1></div>
    <div className="explore-controls">
      <div className="explore-modes" role="group" aria-label="Esplora per">
        <button type="button" aria-pressed={mode === 'faces'} onClick={() => filter('mode', 'faces')}><ScanFace size={18} />Volti</button>
        <button type="button" aria-pressed={mode === 'tags'} onClick={() => filter('mode', 'tags')}><Tags size={18} />Tag</button>
      </div>
      {mode === 'faces' ? <label>Persona<select value={person} onChange={event => filter('person', event.target.value)}>
        <option value="any">Tutti i volti</option><option value="unassigned">Volti non assegnati</option>
        {people.data?.map(item => <option key={item.id} value={item.id}>{item.name} ({item.count})</option>)}
      </select></label> : <label>Tag<select value={tag} onChange={event => filter('tag', event.target.value)}>
        <option value="any">Tutti i tag</option>
        {tags.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      {mode === 'faces' && selectedPerson && <IconButton label="Rinomina persona" disabled={renaming} onClick={() => setRenameTarget(selectedPerson)}><Pencil size={18} /></IconButton>}
      <label>Immagini<select value={kind} onChange={event => filter('kind', event.target.value)}><option value="all">Tutte</option><option value="original">Originali</option><option value="edit">Elaborazioni</option></select></label>
      {mode === 'tags' && <label className="check-label"><input type="checkbox" checked={suggested} onChange={event => filter('suggested', String(event.target.checked))} />Includi suggeriti</label>}
    </div>
    <ErrorBox error={mode === 'faces' ? people.error : tags.error} />
    <AssetGrid key={queryString(filters)} filters={filters} />
    {renameTarget && <PersonNameDialog initialName={renameTarget.name} people={people.data || []} save={renamePerson} close={() => setRenameTarget(null)} />}
  </>
}