import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function fixtures(page: Page, count = 18, isolated = false) {
  let template
  if (isolated) {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    template = { kind: 'original', width: 640, height: 640, preview: image, thumb: image, favorite: false, deleted: false, analysis: 'done' }
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/session') return route.fulfill({ json: { csrf: 'pagination-test', development: true } })
      if (path === '/api/settings') return route.fulfill({ json: { quick_slots: {}, active_slot: '0' } })
      if (path === '/api/login') return route.fulfill({ json: { csrf: 'pagination-test' } })
      if (path === '/api/assets') return route.fulfill({ json: { items: [{ kind: 'original', width: 640, height: 640, preview: image, thumb: image, favorite: false, deleted: false, analysis: 'done' }], next: null } })
      if (path.endsWith('/file/original')) return route.fulfill({ contentType: 'image/png', body: Buffer.from(image.split(',')[1], 'base64') })
      return route.fulfill({ json: [] })
    })
  } else {
    const login = await page.request.post('/api/login', { data: { password: process.env.STUDIO_TEST_PASSWORD || 'studio-local-change-me' } })
    expect(login.ok()).toBeTruthy()
    const response = await page.request.get('/api/assets?kind=original&limit=1').then(result => result.json())
    template = response.items[0]
  }
  const assets = Array.from({ length: count }, (_, position) => ({ ...template, id: `navigation-image-${position}`, name: `Immagine ${position}`, tags: [], faces: [] }))
  const prompts = Array.from({ length: 3 }, (_, position) => ({ id: `navigation-prompt-${position}`, title: `Prompt navigabile ${position}`, text: `Istruzione ${position}`, category: '', tags: [], favorite: false, version: 1, versions: [] }))
  await page.route('**/api/assets?**', route => {
    const params = new URL(route.request().url()).searchParams
    const offset = Number(params.get('offset') || 0)
    const limit = Number(params.get('limit') || 60)
    const items = params.get('kind') === 'edit' ? [] : assets
    return route.fulfill({ json: { items: items.slice(offset, offset + limit), next: offset + limit < items.length ? offset + limit : null } })
  })
  await page.route('**/api/assets/navigation-image-*', route => route.fulfill({ json: assets.find(asset => route.request().url().endsWith(`/${asset.id}`)) }))
  await page.route('**/api/prompts?**', route => route.fulfill({ json: { items: prompts, next: null } }))
  await page.route('**/api/prompts/navigation-prompt-*', route => route.fulfill({ json: prompts.find(prompt => route.request().url().endsWith(`/${prompt.id}`)) }))
  return { assets, prompts }
}

async function swipe(target: Locator, direction: 'left' | 'right') {
  const start = direction === 'left' ? 250 : 70
  const end = direction === 'left' ? 70 : 250
  await target.evaluate((element, position) => {
    const touch = new Touch({ identifier: 1, target: element, clientX: position, clientY: 200 })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }))
  }, start)
  await target.evaluate((element, position) => {
    const touch = new Touch({ identifier: 1, target: element, clientX: position, clientY: 205 })
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }))
  }, end)
}

for (const mode of ['singola', 'multipla']) {
  test(`eliminazione ${mode} non richiede nuovamente il PIN`, async ({ page }) => {
    const { assets } = await fixtures(page, 2, true)
    let locks = 0
    const deleted: string[] = []
    const nativeDialogs: string[] = []
    page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss() })
    await page.route('**/api/privacy**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/privacy/lock') locks += 1
      return route.fulfill({ json: { enabled: true, locked: path === '/api/privacy' || path === '/api/privacy/lock' } })
    })
    await page.route('**/api/assets/navigation-image-*', route => {
      const asset = assets.find(item => route.request().url().endsWith(`/${item.id}`))!
      if (route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON()).toEqual({ deleted: true })
        asset.deleted = true
        deleted.push(asset.id)
      }
      return route.fulfill({ json: asset })
    })
    await page.goto(mode === 'singola' ? `/assets/${assets[0].id}` : '/originals')
    await page.getByLabel('PIN', { exact: true }).fill('123456')
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Blocca app', exact: true })).toBeVisible()
    const initialLocks = locks
    if (mode === 'multipla') {
      await page.getByRole('button', { name: 'Filtri e selezione', exact: true }).click()
      await page.getByRole('button', { name: 'Seleziona', exact: true }).click()
      for (const asset of assets) await page.getByRole('checkbox', { name: `Seleziona ${asset.name}`, exact: true }).click()
    }
    const remove = page.getByRole('button', { name: 'Sposta nel cestino', exact: true })
    await remove.click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation.getByRole('heading', { name: 'Spostare nel cestino?' })).toBeVisible()
    await confirmation.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    expect(deleted).toEqual([])
    await remove.click()
    await confirmation.getByRole('button', { name: 'Sposta nel cestino', exact: true }).click()
    await expect.poll(() => deleted.length).toBe(mode === 'singola' ? 1 : assets.length)
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByLabel('PIN', { exact: true })).toHaveCount(0)
    expect(locks).toBe(initialLocks)
    expect(nativeDialogs).toEqual([])
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.getByLabel('PIN', { exact: true })).toBeVisible()
    await expect.poll(() => locks).toBeGreaterThan(initialLocks)
  })
}

test('anteprima prompt mantiene altezza e larghezza delle righe', async ({ page }) => {
  const { assets, prompts } = await fixtures(page, 18, true)
  const items = [
    { ...prompts[0], latest_thumb: assets[0].thumb },
    { ...prompts[0], id: prompts[1].id, latest_thumb: null },
  ]
  await page.route('**/api/prompts?**', route => route.fulfill({ json: { items, next: null } }))
  await page.goto('/prompts')
  const rows = page.locator('.prompt-row')
  const thumbnail = rows.first().getByRole('img', { name: 'Ultima immagine generata' })
  await expect(thumbnail).toBeVisible()
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await expect(rows.nth(1).locator('.prompt-index')).toHaveText('02')
  await page.evaluate(() => document.fonts.ready)
  for (const width of [320, 390, 700, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    const withThumbnail = await rows.first().boundingBox()
    const withoutThumbnail = await rows.nth(1).boundingBox()
    const image = await thumbnail.boundingBox()
    expect(Math.abs(withThumbnail!.height - withoutThumbnail!.height)).toBeLessThan(1)
    expect(Math.abs(image!.width - image!.height)).toBeLessThan(1)
    expect(image!.width).toBeLessThanOrEqual(45)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await rows.first().click()
  await expect(page).toHaveURL(new RegExp(`/prompts/${prompts[0].id}$`))
})

test('griglia senza sovrapposizioni dopo resize e scroll', async ({ page }) => {
  await fixtures(page)
  await page.goto('/originals')
  for (const width of [320, 390, 700, 1000, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator('.gallery-row').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width < 360 ? 2 : width < 1000 ? 3 : 5)
    await expect.poll(() => page.locator('.gallery-row').evaluateAll(rows => rows.every((row, position) => {
      const bounds = row.getBoundingClientRect()
      const next = rows[position + 1]?.getBoundingClientRect()
      return (!next || bounds.bottom <= next.top + 1) && [...row.querySelectorAll('.asset-image, .asset-caption')].every(element => element.getBoundingClientRect().bottom <= bounds.bottom + 1)
    }))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.evaluate(() => scrollTo(0, 500))
  await expect(page.locator('.asset-image').last()).toBeVisible()
})

test('prompt e immagini navigano con frecce e swipe fuori dallo zoom', async ({ page }) => {
  await fixtures(page)
  await page.goto('/prompts/navigation-prompt-0')
  await expect(page.getByRole('button', { name: 'Prompt precedente' })).toBeDisabled()
  await page.getByRole('button', { name: 'Prompt successivo' }).click()
  await expect(page.getByRole('heading', { name: 'Prompt navigabile 1', exact: true })).toBeVisible()
  await swipe(page.locator('.prompt-text'), 'left')
  await expect(page).toHaveURL(/navigation-prompt-2$/)
  await expect(page.getByRole('button', { name: 'Prompt successivo' })).toBeDisabled()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/navigation-prompt-1$/)
  await page.getByRole('button', { name: 'Modifica', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Nome', { exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/navigation-prompt-1$/)
  await page.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click()
  await page.goto('/assets/navigation-image-0')
  await expect(page.getByRole('button', { name: 'Immagine successiva' })).toBeEnabled()
  await swipe(page.locator('.stage-image img'), 'left')
  await expect(page).toHaveURL(/navigation-image-1$/)
  await expect(page.locator('.pswp--open')).toHaveCount(0)
  await swipe(page.locator('.stage-image img'), 'right')
  await expect(page).toHaveURL(/navigation-image-0$/)
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/navigation-image-1$/)
})

test('pallino seleziona e composer accoda tutte senza duplicare dopo errore parziale', async ({ page }) => {
  const { assets, prompts } = await fixtures(page)
  const requests: { input_id: string; token: string; prompt_id: string; instruction: string }[] = []
  await page.route('**/api/jobs', async route => {
    if (route.request().method() !== 'POST') { await route.fulfill({ json: [] }); return }
    const body = route.request().postDataJSON()
    requests.push(body)
    if (requests.length === 2) { await route.fulfill({ status: 503, json: { detail: 'Errore temporaneo di prova' } }); return }
    await route.fulfill({ json: { id: `batch-job-${requests.length}` } })
  })
  await page.goto(`/originals?pick_prompt=${prompts[0].id}`)
  await page.getByRole('checkbox', { name: `Seleziona ${assets[0].name}`, exact: true }).click()
  await page.getByRole('checkbox', { name: `Seleziona ${assets[1].name}`, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: `Seleziona ${assets[0].name}`, exact: true })).toBeChecked()
  await expect(page.getByText('2 selezionate', { exact: true })).toBeVisible()
  await page.locator('.asset-image').first().click()
  await expect(page.getByRole('dialog').getByLabel('Istruzione aggiuntiva')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click()
  await page.getByRole('button', { name: 'Modifica selezionate', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Istruzione aggiuntiva').fill('Mantieni lo sfondo')
  await dialog.getByRole('button', { name: 'Aggiungi alla coda', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('1 di 2 accodate')
  await dialog.getByRole('button', { name: 'Aggiungi alla coda', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(requests.map(request => request.input_id)).toEqual([assets[0].id, assets[1].id, assets[1].id])
  expect(requests.every(request => request.prompt_id === prompts[0].id && request.instruction === 'Mantieni lo sfondo')).toBe(true)
  expect(requests[1].token).toBe(requests[2].token)
  expect(requests[0].token).not.toBe(requests[1].token)
  await expect(page.getByText('0 selezionate', { exact: true })).toBeVisible()
})

test('zoom supera cento immagini e apre direttamente immagini piu vecchie', async ({ page }) => {
  await fixtures(page, 135, true)
  await page.goto('/assets/navigation-image-98')
  await page.getByRole('button', { name: 'Zoom immagine', exact: true }).click()
  const viewer = page.locator('.pswp--open')
  await expect(viewer.locator('.pswp__counter')).toHaveText('99 / 135')
  await viewer.locator('.pswp__button--arrow--next').click()
  await expect(viewer.locator('.pswp__counter')).toHaveText('100 / 135')
  await viewer.locator('.pswp__button--arrow--next').click()
  await expect(viewer.locator('.pswp__counter')).toHaveText('101 / 135')
  await expect(viewer.locator('.pswp__img[alt="Immagine 100"]').first()).toBeVisible()
  await viewer.locator('.pswp__button--close').click()
  await page.goto('/assets/navigation-image-134')
  await page.getByRole('button', { name: 'Zoom immagine', exact: true }).click()
  await expect(viewer.locator('.pswp__counter')).toHaveText('135 / 135')
  await expect(viewer.locator('.pswp__button--arrow--next')).toBeDisabled()
  await viewer.locator('.pswp__button--arrow--prev').click()
  await expect(viewer.locator('.pswp__counter')).toHaveText('134 / 135')
})

test('galleria e selezione job raggiungono le immagini oltre cento', async ({ page }) => {
  const { assets, prompts } = await fixtures(page, 135, true)
  for (const path of ['/originals', `/originals?pick_prompt=${prompts[0].id}`]) {
    await page.goto(path)
    for (const offset of [60, 120]) {
      const nextPage = page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname === '/api/assets' && url.searchParams.get('offset') === String(offset)
      })
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await nextPage
    }
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await expect(page.locator(`.asset-image img[alt="${assets[134].name}"]`)).toBeVisible()
    if (path.includes('pick_prompt')) {
      await page.getByRole('checkbox', { name: `Seleziona ${assets[134].name}`, exact: true }).click()
      await expect(page.getByText('1 selezionate', { exact: true })).toBeVisible()
      await page.locator(`.asset-image img[alt="${assets[134].name}"]`).click()
      await expect(page.getByRole('dialog').getByText(assets[134].name, { exact: true })).toBeVisible()
    }
  }
})