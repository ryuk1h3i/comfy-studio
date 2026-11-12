export interface Preset {
  id: string; title: string; text: string; category: string; tags: string[];
  favorite: boolean; version: number; archived?: boolean; results?: number; versions?: { version: number; text: string; title: string }[]
}
export interface Settings {
  edit_resolution: number; generation_resolution: number[]; upscale_factor: number;
  loras: { name: string; weight: number }[]; active_slot: string; quick_slots: Record<string, string>; queue_paused: boolean
}
export interface Job {
  id: string; operation: string; status: string; priority: number; input_id: string | null;
  root_id: string | null; prompt_id: string | null; prompt_version: number | null;
  instruction: string; settings: Settings & { seed: number }; progress: string; error: string;
  created: string; comfy_id: string | null
  duration_seconds?: number | null; outputs?: { id: string; name: string; thumb: string }[]
}
export interface Asset {
  id: string; kind: string; name: string; width: number; height: number; mime: string;
  thumb: string; preview: string; favorite: boolean; deleted: boolean; analysis: string; analysis_error: string;
  job_id: string | null; input_id: string | null; root_id: string | null; operation?: string; prompt_id?: string | null;
  job?: Job | null; original?: Asset | null; input?: Asset | null;
  tags?: { id: string; name: string; state: string; score: number }[];
  faces?: { id: string; person_id: string | null; locked: boolean; box: Record<string, number> }[]
}
export interface Tag { id: string; name: string; description: string; threshold: number; automatic: boolean }
export interface Person { id: string; name: string; count: number; asset_id: string }
export interface Page<T> { items: T[]; next: number | null }

let csrf = ''
export function setCsrf(value: string) { csrf = value }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['x-csrf-token'] = csrf
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json'
  const response = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }))
    if (response.status === 401 && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('session-expired'))
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Dati non validi')
  }
  return response.json()
}
export function queryString(values: Record<string, string | boolean | number | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)) })
  return params.toString()
}
export function token() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }