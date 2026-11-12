import { useEffect, useRef } from 'react'
import type { TouchEvent } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import type { Page } from './api'

export function useDetailNavigation(path: string, id: string | undefined, route: string, enabled = true) {
  const navigate = useNavigate()
  const start = useRef<{ x: number; y: number } | null>(null)
  const query = useInfiniteQuery({ queryKey: ['detail-navigation', path], enabled, initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Page<{ id: string }>>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${pageParam}`),
    getNextPageParam: page => page.next ?? undefined })
  const items = query.data?.pages.flatMap(page => page.items) || []
  const index = items.findIndex(item => item.id === id)
  const previous = index > 0 ? items[index - 1].id : undefined
  const next = index >= 0 ? items[index + 1]?.id : undefined
  useEffect(() => {
    if (enabled && query.hasNextPage && !query.isFetching && !query.isError && (index < 0 || index >= items.length - 2)) query.fetchNextPage()
  }, [enabled, index, items.length, query.hasNextPage, query.isFetching, query.isError])
  function move(target: string | undefined) { if (target) navigate(`${route}/${target}`, { replace: true }) }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open], .pswp--open') || (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' && previous) { event.preventDefault(); move(previous) }
      if (event.key === 'ArrowRight' && next) { event.preventDefault(); move(next) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [previous, next, route])
  return { previous: () => move(previous), next: () => move(next), hasPrevious: !!previous, hasNext: !!next,
    onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || (event.target as HTMLElement).closest('button:not(.stage-image), a, input, textarea, select')) { start.current = null; return }
      start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    },
    onTouchEnd(event: TouchEvent) {
      const origin = start.current; start.current = null
      if (!origin || !event.changedTouches.length) return
      const deltaX = event.changedTouches[0].clientX - origin.x
      const deltaY = event.changedTouches[0].clientY - origin.y
      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) { event.preventDefault(); move(deltaX < 0 ? next : previous) }
    },
  }
}