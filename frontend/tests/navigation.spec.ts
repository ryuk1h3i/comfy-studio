import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function fixtures(page: Page) {
  const login = await page.request.post('/api/login', { data: { password: process.env.STUDIO_TEST_PASSWORD || 'studio-local-change-me' } })
  expect(login.ok()).toBeTruthy()
  const response = await page.request.get('/api/assets?kind=original&limit=1').then(result => result.json())
  const template = response.items[0]
  const assets = Array.from({ length: 18 }, (_, position) => ({ ...template, id: `navigation-image-${position}`, name: `Immagine ${position}`, tags: [], faces: [] }))
  const prompts = Array.from({ length: 3 }, (_, position) => ({ id: `navigation-prompt-${position}`, title: `Prompt navigabile ${position}`, text: `Istruzione ${position}`, category: '', tags: [], favorite: false, version: 1, versions: [] }))
  await page.route('**/api/assets?**', route => route.fulfill({ json: { items: route.request().url().includes('kind=edit') ? [] : assets, next: null } }))
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