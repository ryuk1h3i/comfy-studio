export function separatorError(text: string, separator: string) {
  if (!text.trim()) return ''
  const marker = separator.trim()
  if (!marker) return 'Indica un separatore, ad esempio ---.'
  if (!text.replace(/\r\n?/g, '\n').split('\n').some(line => line.trim() === marker)) return `Separatore "${marker}" non trovato su una riga dedicata.`
  if (splitPrompts(text, marker).length < 2) return 'Inserisci almeno due prompt non vuoti divisi dal separatore.'
  return ''
}

export function splitPrompts(text: string, separator: string) {
  const marker = separator.trim()
  if (!marker) return []
  const blocks: string[] = []
  let lines: string[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === marker) {
      const block = lines.join('\n').trim()
      if (block) blocks.push(block)
      lines = []
    } else lines.push(line)
  }
  const last = lines.join('\n').trim()
  if (last) blocks.push(last)
  return blocks.map(block => ({ title: block.split('\n')[0].slice(0, 160), text: block }))
}