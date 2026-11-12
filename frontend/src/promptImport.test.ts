import { describe, expect, it } from 'vitest'
import { separatorError, splitPrompts } from './promptImport'

describe('importazione prompt', () => {
  it('richiede un separatore su riga dedicata e due blocchi non vuoti', () => {
    expect(separatorError('Uno senza separatore', '---')).toContain('non trovato')
    expect(separatorError('Uno --- due', '---')).toContain('non trovato')
    expect(separatorError('---\nUno', '---')).toContain('almeno due')
    expect(separatorError('Uno\n***\nDue', '***')).toBe('')
    expect(separatorError('Uno', '')).not.toBe('')
    expect(separatorError('', '---')).toBe('')
  })
  it('separa solo righe intere, mantiene testo multilinea e ignora blocchi vuoti', () => {
    expect(splitPrompts('---\r\nPrimo --- testo\r\nseconda riga\r\n --- \r\n\r\n---\r\nUltimo\r\n---', '---')).toEqual([
      { title: 'Primo --- testo', text: 'Primo --- testo\nseconda riga' }, { title: 'Ultimo', text: 'Ultimo' },
    ])
  })
  it('supporta separatori letterali personalizzati senza regex', () => {
    expect(splitPrompts('Uno\n***\nDue', '***')).toHaveLength(2)
    expect(splitPrompts('Uno', '')).toEqual([])
  })
})