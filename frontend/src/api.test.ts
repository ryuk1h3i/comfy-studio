import { describe, expect, it } from 'vitest'
import { queryString } from './api'

describe('filtri galleria', () => {
  it('conserva false e offset e codifica query italiane', () => {
    const params = new URLSearchParams(queryString({ q: 'città e mare', favorite: false, offset: 0, missing: undefined, empty: '' }))
    expect(params.get('q')).toBe('città e mare')
    expect(params.get('favorite')).toBe('false')
    expect(params.get('offset')).toBe('0')
    expect(params.has('missing')).toBe(false)
    expect(params.has('empty')).toBe(false)
  })
})