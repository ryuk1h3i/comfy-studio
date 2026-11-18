import { expect, test } from '@playwright/test'
import type { Settings } from '../src/api'

test('selezione Flux conserva impostazioni comuni e LoRA dopo il salvataggio', async ({ page }) => {
  let settings: Settings = {
    workflow: 'flux2', edit_resolution: 0.6, generation_resolution: [1024, 512],
    upscale_factor: 2.5, loras: [{ name: 'custom.safetensors', weight: 0.5 }],
    active_slot: '1', quick_slots: { '1': 'preset-1' }, queue_paused: false,
  }
  await page.route('**/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/session') return route.fulfill({ json: { csrf: 'settings-test', development: true } })
    if (path === '/api/privacy') return route.fulfill({ json: { enabled: false, locked: false } })
    if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: '' })
    if (path === '/api/settings') {
      if (request.method() === 'PUT') settings = { ...settings, ...request.postDataJSON() }
      return route.fulfill({ json: settings })
    }
    if (path === '/api/prompts') return route.fulfill({ json: { items: [{ id: 'preset-1', title: 'Paesaggio' }], next: null } })
    if (path === '/api/loras') return route.fulfill({ json: ['custom.safetensors'] })
    return route.fulfill({ json: [] })
  })

  await page.goto('/settings')
  const model = page.getByLabel('Modello', { exact: true })
  const resolution = page.getByLabel('Risoluzione edit')
  const width = page.getByLabel('Larghezza generation')
  const height = page.getByLabel('Altezza generation')
  const upscale = page.getByLabel('Fattore upscale')
  const lora = page.getByLabel('Nome LoRA 1', { exact: true })
  await expect(model).toHaveValue('flux2')
  await expect(lora).toHaveValue('custom.safetensors')
  await resolution.fill('0.8')
  await model.selectOption('flux3')
  await expect(lora).toHaveCount(0)
  await expect(resolution).toHaveValue('0.8')
  await expect(width).toHaveValue('1024')
  await expect(height).toHaveValue('512')
  await expect(upscale).toHaveValue('2.5')
  await expect(page.getByLabel('Slot attivo')).toHaveValue('1')
  await expect(page.getByLabel('Slot 1', { exact: true })).toHaveValue('preset-1')
  await page.getByRole('button', { name: 'Salva impostazioni' }).click()
  await expect(page.getByText('Impostazioni salvate', { exact: true })).toBeVisible()
  expect(settings.workflow).toBe('flux3')
  expect(settings.loras).toEqual([{ name: 'custom.safetensors', weight: 0.5 }])
  await page.reload()
  await expect(model).toHaveValue('flux3')
  await expect(resolution).toHaveValue('0.8')
  await model.selectOption('flux2')
  await expect(lora).toHaveValue('custom.safetensors')
  await expect(page.getByLabel('Peso LoRA 1', { exact: true })).toHaveValue('0.5')
  await expect(width).toHaveValue('1024')
  await expect(height).toHaveValue('512')
  await expect(upscale).toHaveValue('2.5')
  await page.getByRole('button', { name: 'Salva impostazioni' }).click()
  await expect.poll(() => settings.workflow).toBe('flux2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})