import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const image = readFileSync(new URL('../public/icon-512.png', import.meta.url))

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/login', { data: { password: process.env.STUDIO_TEST_PASSWORD || 'studio-local-change-me' } })
  expect(response.ok()).toBeTruthy()
  await page.goto('/originals')
  await expect(page.getByRole('heading', { name: 'Originali', exact: true })).toBeVisible()
})

test('tre tab, upload, zoom e dettaglio', async ({ page }) => {
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(3)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'browser-upload.png', mimeType: 'image/png', buffer: image })
  await page.getByRole('button', { name: 'Conferma caricamento (1)' }).click()
  const asset = page.locator('.asset-image').first()
  await expect(asset).toBeVisible()
  await asset.click()
  await page.getByRole('button', { name: 'Zoom immagine' }).click()
  await expect(page.locator('.pswp img.pswp__img').last()).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Dettagli', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Modifica', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tutte le elaborazioni' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('analizza accoda e aggiorna automaticamente il dettaglio', async ({ page }) => {
  const originals = await page.request.get('/api/assets?kind=original&limit=1').then(response => response.json())
  const original = originals.items[0]
  let state = 'failed'
  await page.route('**/api/assets/analysis-test', async route => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ reanalyze: true })
      state = 'pending'
    }
    await route.fulfill({ json: { ...original, id: 'analysis-test', analysis: state, analysis_error: state === 'failed' ? 'Errore ML precedente' : '', tags: state === 'done' ? [{ id: 'analysis-tag', name: 'Paesaggio analizzato', state: 'manual' }] : [], faces: [] } })
  })
  await page.goto('/assets/analysis-test')
  await expect(page.getByText('Errore ML precedente')).toBeVisible()
  await page.getByRole('button', { name: 'Analizza', exact: true }).click()
  await expect(page.getByText('Analisi accodata', { exact: true })).toBeVisible()
  await expect(page.getByText('Analisi: In attesa del worker ML', { exact: true })).toBeVisible()
  await expect(page.getByText('Errore ML precedente')).toHaveCount(0)
  state = 'done'
  await expect(page.getByText('Analisi: Completata', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Paesaggio analizzato', { exact: true })).toBeVisible()
})

test('clipboard mostra anteprima prima di caricare', async ({ page }) => {
  await page.evaluate(async () => {
    const blob = await fetch('/icon-192.png').then(response => response.blob())
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'clipboard-test.png', { type: 'image/png' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('button', { name: 'Conferma caricamento (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Rimuovi upload' }).click()
  await page.getByRole('textbox', { name: 'Cerca immagini' }).fill('testo incollato')
  await expect(page.getByRole('textbox', { name: 'Cerca immagini' })).toHaveValue('testo incollato')
})

test('galleria compatta e filtri richiudibili', async ({ page }) => {
  const grid = page.locator('.gallery-grid')
  await expect(grid).toBeVisible()
  await expect(page.getByLabel('Filtra per tag')).toHaveCount(0)
  await page.locator('summary[aria-label="Aggiungi immagini"]').click()
  await expect(page.getByRole('button', { name: 'Incolla immagine', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fotocamera', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Incolla immagine', exact: true })).not.toBeVisible()
  const before = await grid.boundingBox()
  expect(before).not.toBeNull()
  if (page.viewportSize()!.width <= 700) {
    expect(before!.y).toBeLessThan(200)
    const columns = await page.locator('.gallery-row').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
    expect(columns).toBe(3)
  }
  await page.getByRole('button', { name: 'Filtri e selezione' }).click()
  await expect(page.getByLabel('Filtra per tag')).toBeVisible()
  await page.getByRole('button', { name: 'Preferiti', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filtri e selezione' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Azzera filtri' }).click()
  await page.getByRole('button', { name: 'Filtri e selezione' }).click()
  await expect(page.getByLabel('Filtra per tag')).toHaveCount(0)
  await expect(grid).toBeVisible()
  const after = await grid.boundingBox()
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.asset-image').first().click()
  await expect(page.getByRole('button', { name: 'Zoom immagine' })).toBeVisible()
})

test('layout senza overflow da telefono stretto a desktop', async ({ page }) => {
  for (const width of [320, 390, 700, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    const expectedColumns = width < 360 ? 2 : width < 1000 ? 3 : 5
    await expect.poll(() => page.locator('.gallery-row').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(expectedColumns)
    const image = await page.locator('.asset-image').first().boundingBox()
    expect(image!.width).toBeLessThan(width / expectedColumns)
    expect(Math.abs(image!.height - image!.width)).toBeLessThan(2)
    const rows = page.locator('.gallery-row')
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index)
      const bounds = await row.boundingBox()
      const caption = await row.locator('.asset-caption').first().boundingBox()
      expect(bounds!.y + bounds!.height - caption!.y - caption!.height).toBeGreaterThanOrEqual(15)
      if (index + 1 < await rows.count()) {
        const next = await rows.nth(index + 1).boundingBox()
        expect(next!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1)
      }
    }
    if (width <= 700) expect(image!.y).toBeLessThan(200)
    const search = await page.getByRole('textbox', { name: 'Cerca immagini' }).boundingBox()
    expect(search!.width).toBeGreaterThan(140)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('menu e tema persistente seguono la scelta e il sistema', async ({ page }) => {
  await page.getByRole('button', { name: 'Apri menu' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('link', { name: 'Impostazioni' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Scuro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(23, 25, 26)')
  await page.getByRole('button', { name: 'Apri menu' }).click()
  await dialog.getByRole('button', { name: 'Chiaro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await dialog.getByRole('button', { name: 'Sistema', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('coda mostra risultato apribile e durata', async ({ page }) => {
  const originals = await page.request.get('/api/assets?kind=original&limit=1').then(response => response.json())
  const original = originals.items[0]
  const result = { ...original, id: 'queue-result-test', kind: 'edit', name: 'Risultato test.png', tags: [], faces: [] }
  await page.route('**/api/assets/queue-result-test', route => route.fulfill({ json: result }))
  await page.route('**/api/jobs', route => route.fulfill({ json: [{ id: 'queue-result-job', status: 'succeeded', operation: 'create', instruction: 'Test risultato coda', progress: 'Completato', settings: { seed: 1 }, error: '', duration_seconds: 125, outputs: [{ id: result.id, name: result.name, thumb: original.thumb }] }] }))
  await page.goto('/queue')
  await expect(page.getByText('Completato in 2 min 5 s', { exact: true })).toBeVisible()
  const thumbnail = page.getByRole('link', { name: 'Apri risultato Risultato test.png' })
  await expect(thumbnail.getByRole('img')).toBeVisible()
  expect(await thumbnail.getByRole('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await thumbnail.click()
  await expect(page).toHaveURL(/\/edits\/queue-result-test$/)
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Edits' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Zoom immagine' })).toBeVisible()
})

test('bulk richiede separatore e mostra suggerimento', async ({ page }) => {
  await page.getByRole('navigation').getByRole('link', { name: 'Prompts' }).click()
  await page.getByRole('button', { name: 'Importa prompt', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Separatore consigliato/)).toBeVisible()
  await dialog.getByLabel('Prompt da importare').fill('Primo prompt senza separatore\nSecondo prompt')
  await expect(dialog.getByRole('alert')).toContainText('non trovato')
  await expect(dialog.getByRole('button', { name: /^Importa \d+ prompt$/ })).toBeDisabled()
  await dialog.getByLabel('Prompt da importare').fill('Primo prompt\n---\nSecondo prompt')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Importa 2 prompt' })).toBeEnabled()
})

test('import bulk e modifica immagine da prompt', async ({ page }) => {
  const marker = `Bulk browser ${Date.now()}`
  await page.getByRole('navigation').getByRole('link', { name: 'Prompts' }).click()
  await page.getByRole('button', { name: 'Importa prompt', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Prompt da importare').fill(`${marker} uno\nPrima istruzione\n---\n${marker} due\nSeconda istruzione`)
  await expect(dialog.getByRole('textbox', { name: /^Nome 1/ })).toHaveValue(`${marker} uno`)
  await dialog.getByRole('textbox', { name: /^Nome 1/ }).fill(`${marker} personalizzato`)
  await dialog.getByRole('button', { name: 'Importa 2 prompt' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: `${marker} personalizzato`, exact: true }) }).click()
  await page.getByRole('link', { name: 'Modifica immagine', exact: true }).click()
  await expect(page.getByText('Scegli immagine', { exact: true })).toBeVisible()
  await page.locator('.asset-image').first().click()
  await expect(dialog.getByRole('heading', { name: 'Modifica immagine' })).toBeVisible()
  await expect(dialog.locator('.prompt-preview')).toContainText('Prima istruzione')
  const selected = await dialog.getByLabel('Prompt salvato').inputValue()
  const response = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Aggiungi alla coda' }).click()
  const job = await (await response).json()
  expect(job.operation).toBe('edit')
  expect(job.input_id).toBeTruthy()
  expect(job.prompt_id).toBe(selected)
  expect(job.instruction).toContain('Prima istruzione')
  const session = await page.request.get('/api/session').then(response => response.json())
  await page.request.patch(`/api/jobs/${job.id}`, { headers: { 'x-csrf-token': session.csrf }, data: { action: 'cancel' } })
})

test('barra passi e spinner globale durante elaborazione', async ({ page }) => {
  let progress = 'Passi 3/10'
  let status = 'running'
  await page.route('**/api/jobs', route => route.fulfill({ json: [{ id: 'mock-running', operation: 'edit', status, priority: 0, instruction: 'Test avanzamento', progress, settings: { seed: 1 }, error: '', comfy_id: 'mock-remote' }] }))
  await page.goto('/queue')
  await expect(page.getByRole('status', { name: 'Elaborazione immagini in corso' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Avanzamento elaborazione' })).toHaveAttribute('value', '30')
  progress = 'Elaborazione nodo 12'
  await page.reload()
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('value')
  status = 'succeeded'
  await page.reload()
  await expect(page.getByRole('status', { name: 'Nessuna elaborazione in corso' })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
})

test('prompt e create accodato senza originale', async ({ page }) => {
  const title = `Browser ${Date.now()}`
  await page.getByRole('navigation').getByRole('link', { name: 'Prompts' }).click()
  await page.getByRole('button', { name: 'Nuovo prompt', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome', { exact: true }).fill(title)
  await dialog.getByLabel('Prompt', { exact: true }).fill('Una fotografia del mare')
  await dialog.getByRole('button', { name: 'Salva prompt' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Crea immagine', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Aggiungi alla coda' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: /^Coda,/ }).click()
  await expect(page.getByText('Una fotografia del mare').first()).toBeVisible()
  await expect(page.getByText('In attesa', { exact: true }).first()).toBeVisible()
})