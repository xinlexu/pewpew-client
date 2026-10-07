import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

// Set PLAYWRIGHT_MODULE to a preinstalled playwright index.mjs when not local.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
)
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'target', 'connection-ui-checks')
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { '@': path.join(root, 'src'), '@root': root } },
  define: { OS_PLATFORM: JSON.stringify(process.platform) },
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const base = `http://127.0.0.1:${address.port}/tests/ui/connection.html`
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const open = async (query = '') => {
    await page.goto(`${base}?${query}`)
    await button('Standard').waitFor()
  }
  const mutations = () =>
    page.evaluate(() =>
      window.connectionTest.calls.filter(
        ({ command }) =>
          command === 'patch_verge_config' ||
          command === 'prepare_enhanced_connection',
      ),
    )
  const state = () => page.evaluate(() => window.connectionTest.state)
  const capture = async (name) => {
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      )
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) =>
            Number.isFinite(animation.effect.getComputedTiming().endTime),
          )
          .map((animation) => animation.finished.catch(() => {})),
      )
    })
    await page.screenshot({
      path: path.join(output, name),
      animations: 'disabled',
    })
  }
  const noOverflow = async () => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    )
    const clipped = await page
      .locator('button, h2, h4, h5, p')
      .evaluateAll((elements) =>
        elements
          .filter((el) => {
            if (!el.getClientRects().length) return false
            return (
              el.scrollWidth > el.clientWidth + 2 ||
              el.scrollHeight > el.clientHeight + 2
            )
          })
          .map((el) => el.textContent),
      )
    assert.deepEqual(clipped, [])
  }

  await open()
  await button('Enhanced').click()
  await page.getByRole('dialog').waitFor()
  await capture('desktop-consent.png')
  await button('Cancel').click()
  assert.equal(
    (await mutations()).length,
    0,
    'cancel must not mutate network or preferences',
  )
  await button('Enhanced').click()
  await button('Allow').click()
  await page.waitForFunction(
    () => window.connectionTest.state.settings.pewpew_enhanced_accepted,
  )
  await button('Connect').click()
  await button('Disconnect').waitFor()
  assert.equal((await state()).config.tun.enable, true)
  assert.equal((await state()).system.enable, true)
  await button('Check Connection').click()
  await page.getByText('Not tested', { exact: true }).waitFor()
  await noOverflow()
  await capture('desktop-diagnostics.png')
  await button('Close').click()
  await button('Disconnect').click()
  await button('Connect').waitFor()
  assert.equal((await state()).config.tun.enable, false)
  assert.equal((await state()).system.enable, false)
  assert.equal((await state()).settings.pewpew_enhanced_mode, true)
  const firstChanges = await mutations()
  assert.equal(firstChanges[0].command, 'patch_verge_config')
  assert.equal(
    firstChanges[0].payload.payload.enable_tun_mode,
    undefined,
    'mode selection offline must not connect',
  )
  console.log(
    'PASS consent, remembered preference, connect/disconnect, truthful diagnostics',
  )

  await open('connected&accepted&fail=tun')
  await button('Enhanced').click()
  await page.getByText('Connection failed', { exact: true }).waitFor()
  assert.equal(
    (await state()).system.enable,
    true,
    'failed mode change must retain previous connection',
  )
  assert.equal((await state()).config.tun.enable, false)
  assert.equal((await state()).settings.pewpew_enhanced_mode, false)
  console.log('PASS failed mode switch restores standard connection')

  await open('enhanced&accepted&fail=prepare')
  await button('Connect').click()
  await page
    .getByText(/Another client's background service was detected/)
    .waitFor()
  assert.equal((await state()).system.enable, false)
  assert.equal(
    (await mutations()).some(({ command }) => command === 'patch_verge_config'),
    false,
  )
  console.log('PASS foreign service is not overwritten')

  await open('connected&enhanced&accepted&fail=disconnect')
  await button('Disconnect').click()
  await page.getByText('Connection failed', { exact: true }).waitFor()
  assert.equal(
    (await state()).system.enable,
    false,
    'partial disconnect must not reconnect system proxy',
  )
  assert.equal((await state()).config.tun.enable, true)
  await button('Disconnect').waitFor()
  console.log(
    'PASS partial disconnect remains visibly connected and does not reconnect proxy',
  )

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await open('enhanced&accepted&noUdp&dark')
    await page.getByText(/UDP is disabled on this route/).waitFor()
    await noOverflow()
    await capture(`warning-${width}.png`)
    await button('Check Connection').click()
    await page.getByText('Not tested', { exact: true }).waitFor()
    await noOverflow()
    await capture(`diagnostics-${width}.png`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}?lang=zh`)
  await page
    .getByRole('button', { name: '\u589e\u5f3a\u517c\u5bb9', exact: true })
    .click()
  await page.getByRole('dialog').waitFor()
  await noOverflow()
  await capture('zh-consent.png')
  assert.deepEqual(errors, [])
  console.log(
    `PASS desktop/mobile layouts, Chinese/English consent; screenshots: ${output}`,
  )
} finally {
  await browser?.close()
  await server.close()
}
