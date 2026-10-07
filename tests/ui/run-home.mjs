import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import svgr from 'vite-plugin-svgr'

// Home page checks with mocked IPC (see home.tsx); they never change the host
// network. Set PLAYWRIGHT_MODULE to a preinstalled playwright index.mjs when not local.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
)
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'target', 'home-ui-checks')
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  plugins: [svgr(), react()],
  resolve: { alias: { '@': path.join(root, 'src'), '@root': root } },
  define: { OS_PLATFORM: JSON.stringify(process.platform) },
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const port = server.httpServer.address().port
const base = `http://127.0.0.1:${port}/tests/ui/home.html`
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  headless: true,
})
const results = []
const check = async (name, fn) => {
  const page = await browser.newPage({ viewport: { width: 940, height: 700 } })
  const errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => errors.push(e.message))
  const open = async (query = '') => {
    await page.goto(`${base}?theme=light&lang=zh&${query}`)
    await page.waitForSelector('.pewpew-shell')
    await page.waitForTimeout(1500)
  }
  const state = () => page.evaluate(() => window.homeTest.state)
  const toasts = () => page.locator('.MuiAlert-filled').allInnerTexts()
  try {
    await fn({ page, open, state, toasts })
    assert.deepEqual(errors, [])
    results.push(`PASS ${name}`)
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`)
    console.log(`FAIL ${name}: ${error.message}`)
    await page.screenshot({
      path: path.join(output, `failure-${results.length}.png`),
    })
  } finally {
    await page.close()
  }
}
const groupNow = (page, name) =>
  page.evaluate(async (n) => {
    const r = await window.__TAURI_INTERNALS__.invoke(
      'plugin:mihomo|get_proxies',
    )
    return r.proxies[n]?.now
  }, name)

for (const failure of ['failSelection', 'ignoreSelection']) {
  await check(
    `global mode is not activated when route selection fails: ${failure}`,
    async ({ page, open, state }) => {
      await open(`scenario=connected&globalNow=DIRECT&${failure}`)
      await page.getByRole('button', { name: '全局模式', exact: true }).click()
      await page.getByText('线路切换失败，请稍后重试或联系客服').waitFor()
      assert.equal((await state()).config.mode, 'rule')
      assert.equal((await state()).system.enable, true)
      assert.equal(
        await page.evaluate(() =>
          window.homeTest.calls.some((c) => c.command === 'patch_clash_mode'),
        ),
        false,
      )
    },
  )
}

await check(
  'fresh core selection is checked even when the page still shows a valid route',
  async ({ page, open, state }) => {
    await open()
    await page.evaluate(() => {
      window.homeTest.records['PewPew 云'].now = '剩余流量：86.42 GB'
    })
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('已连接', { exact: true }).waitFor()
    assert.equal(await groupNow(page, 'PewPew 云'), '🇭🇰 香港 01')
    assert.equal((await state()).system.enable, true)
  },
)

await check(
  'concurrent checks validate both requested modes independently',
  async ({ page, open }) => {
    await open('guardProbe&infoSelected=1&globalNow=DIRECT&slowIpc')
    await page.waitForFunction(
      () => typeof window.homeTest.ensureBoth === 'function',
    )
    assert.deepEqual(await page.evaluate(() => window.homeTest.ensureBoth()), [
      true,
      true,
    ])
    assert.equal(await groupNow(page, 'PewPew 云'), '🇭🇰 香港 01')
    assert.equal(await groupNow(page, 'GLOBAL'), 'PewPew 云')
  },
)

await check(
  'connection and subscription controls wait for target route preparation',
  async ({ page, open, state }) => {
    await open('globalNow=DIRECT&selectionDelay=700')
    await page.getByRole('button', { name: '更换订阅' }).click()
    await page
      .getByRole('textbox', { name: '订阅链接' })
      .fill('https://sub.example.invalid/new')
    await page.getByRole('button', { name: '全局模式', exact: true }).click()
    await page.waitForFunction(() =>
      window.homeTest.calls.some(
        (c) => c.command === 'plugin:mihomo|select_node_for_group',
      ),
    )
    assert.ok(
      await page
        .getByRole('button', { name: '连接', exact: true })
        .isDisabled(),
    )
    assert.ok(
      await page
        .getByRole('button', { name: '导入线路', exact: true })
        .isDisabled(),
    )
    assert.ok(await page.getByRole('combobox').isDisabled())
    await page.waitForFunction(
      () => window.homeTest.state.config.mode === 'global',
    )
    const selections = await page.evaluate(() =>
      window.homeTest.calls.filter(
        (c) => c.command === 'plugin:mihomo|select_node_for_group',
      ),
    )
    assert.ok(
      selections.every((c) => c.mode === 'rule'),
      'route must be ready before switching live mode',
    )
    assert.equal((await state()).system.enable, false)
  },
)

await check(
  'failed route preparation never connects',
  async ({ page, open, state }) => {
    await open('infoSelected=1&failSelection')
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    assert.equal((await state()).system.enable, false)
  },
)

await check(
  'paste and import shows the new routes without restarting',
  async ({ page, open, state }) => {
    await open('scenario=empty')
    await page.getByRole('button', { name: '粘贴', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '订阅链接' }).inputValue(),
      'https://sub.example.invalid/api?token=fixture',
    )
    await page.getByRole('button', { name: '导入线路', exact: true }).click()
    await page.getByRole('button', { name: '连接', exact: true }).waitFor()
    assert.equal((await state()).profiles.current, 'R2')
    assert.ok(await page.getByRole('combobox').isVisible())
    assert.equal((await state()).system.enable, false)
  },
)

await check(
  'import disconnects before activating a different subscription',
  async ({ page, open, state }) => {
    await open('scenario=connected')
    await page.getByRole('button', { name: '更换订阅' }).click()
    await page
      .getByRole('textbox', { name: '订阅链接' })
      .fill('https://sub.example.invalid/new')
    await page.getByRole('button', { name: '导入线路', exact: true }).click()
    await page.waitForFunction(
      () => window.homeTest.state.profiles.current === 'R2',
    )
    const calls = await page.evaluate(() => window.homeTest.calls)
    const disconnect = calls.findIndex(
      (c) =>
        c.command === 'patch_verge_config' &&
        c.args.payload.enable_system_proxy === false,
    )
    assert.ok(
      disconnect >= 0 &&
        disconnect <
          calls.findIndex((c) => c.command === 'patch_profiles_config'),
    )
    assert.equal((await state()).system.enable, false)
  },
)

await check('YAML import remains available', async ({ page, open, state }) => {
  await open('scenario=empty')
  await page
    .getByRole('button', { name: '导入 YAML 文件', exact: true })
    .click()
  await page.getByRole('button', { name: '连接', exact: true }).waitFor()
  assert.equal((await state()).profiles.current, 'R2')
})

await check(
  'file dialog failure is handled without an unhandled rejection',
  async ({ page, open }) => {
    await open('scenario=empty&failDialog')
    await page
      .getByRole('button', { name: '导入 YAML 文件', exact: true })
      .click()
    await page.locator('.MuiAlert-filled').waitFor()
  },
)

await check(
  'switching to global points GLOBAL at the current route',
  async ({ page, open, toasts }) => {
    await open('scenario=connected&globalNow=DIRECT')
    await page.getByRole('button', { name: '全局模式', exact: true }).click()
    await page.waitForTimeout(1500)
    assert.equal(await groupNow(page, 'GLOBAL'), 'PewPew 云')
    assert.ok((await toasts()).some((t) => t.includes('已自动切换到')))
    assert.ok(
      await page
        .getByText('全局模式 · 🇭🇰 香港 01', { exact: false })
        .isVisible(),
    )
  },
)

await check(
  'connecting with an info node selected picks a real route first',
  async ({ page, open, state }) => {
    await open('infoSelected=1')
    assert.ok(
      await page.getByText('还没有选择线路，连接时会自动选择').isVisible(),
    )
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.waitForTimeout(1500)
    assert.equal(await groupNow(page, 'PewPew 云'), '🇭🇰 香港 01')
    assert.equal((await state()).system.enable, true)
  },
)

await check(
  'connected + global + DIRECT is repaired on load',
  async ({ page, open }) => {
    await open('scenario=connected&mode=global&globalNow=DIRECT')
    await page.waitForTimeout(1500)
    assert.equal(await groupNow(page, 'GLOBAL'), 'PewPew 云')
  },
)

await check(
  'repairing from Preferences clears the stale failure',
  async ({ page, open }) => {
    await open('coreDown=1')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.homeTest.state.coreDown = false
    })
    await page.getByRole('button', { name: '偏好设置' }).click()
    await page.getByRole('button', { name: '恢复网络' }).click()
    await page.getByText('网络已恢复，请重新连接').waitFor({ timeout: 8000 })
    await page.getByRole('button', { name: '关闭', exact: true }).last().click()
    await page.waitForTimeout(500)
    assert.equal(await page.getByText('连接失败', { exact: true }).count(), 0)
    assert.ok(await page.getByText('未连接', { exact: true }).isVisible())
  },
)

await check(
  'a failed repair shows a single error notice',
  async ({ page, open, toasts }) => {
    await open('coreDown=1')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    await page.locator('.MuiAlert-filled button').first().click()
    await page.waitForTimeout(400)
    const before = (await toasts()).length
    await page.getByRole('button', { name: '恢复网络' }).click()
    await page.getByText('恢复失败，请联系客服').waitFor({ timeout: 8000 })
    await page.waitForTimeout(1500)
    const after = await toasts()
    assert.equal(after.length - before, 1, `toasts: ${after.join(' | ')}`)
    assert.ok(after.some((t) => t.includes('恢复失败')))
  },
)

await check(
  'connect failure uses a specific message',
  async ({ page, open, toasts }) => {
    await open('coreDown=1')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    const list = await toasts()
    assert.ok(
      list.some((t) => t.includes('连接核心没有运行')),
      list.join(' | '),
    )
  },
)

await check(
  'an external reconnect clears the failure state',
  async ({ page, open }) => {
    await open('coreDown=1')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    // Simulate the tray connecting successfully afterwards.
    await page.evaluate(() => {
      const s = window.homeTest.state
      s.coreDown = false
      s.verge.enable_system_proxy = true
      s.system.enable = true
    })
    // The backend emits refresh events after tray actions; emulate the refetch.
    await page.evaluate(async () => {
      const { queryClient } = await import('/src/services/query-client.ts')
      await queryClient.invalidateQueries()
    })
    await page.getByText('已连接', { exact: true }).waitFor({ timeout: 8000 })
    assert.equal(await page.getByText('连接失败', { exact: true }).count(), 0)
  },
)

await check(
  'typing a link does not re-register native drag listeners',
  async ({ page, open }) => {
    await open()
    await page.getByRole('button', { name: '更换订阅' }).click()
    const before = await page.evaluate(() => ({ ...window.homeTest.counts }))
    await page.getByRole('textbox', { name: '订阅链接' }).click()
    await page.keyboard.type('https://example.com/sub', { delay: 15 })
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => ({ ...window.homeTest.counts }))
    assert.equal(
      (after['plugin:event|listen'] || 0) -
        (before['plugin:event|listen'] || 0),
      0,
    )
  },
)

await check(
  'mode toggle works from the keyboard',
  async ({ page, open, state }) => {
    await open()
    await page.getByRole('button', { name: '全局模式', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
    assert.equal((await state()).config.mode, 'global')
  },
)

await check('no onboarding flash while routes load', async ({ page }) => {
  await page.goto(`${base}?theme=light&lang=zh&slowProxies=4000`)
  await page.waitForSelector('.pewpew-shell')
  await page.waitForTimeout(600)
  assert.equal(await page.getByText('导入线路，开始使用').count(), 0)
  assert.ok(await page.getByText('正在加载线路…').isVisible())
})

await check(
  'empty profile shows onboarding instead of a dead connect button',
  async ({ page, open }) => {
    await open('scenario=empty')
    assert.ok(await page.getByText('导入线路，开始使用').isVisible())
    assert.equal(
      await page.getByRole('button', { name: '连接', exact: true }).count(),
      0,
    )
  },
)

await check(
  'auto-connect preference removed, auto-close renamed',
  async ({ page, open }) => {
    await open()
    await page.getByRole('button', { name: '偏好设置' }).click()
    assert.equal(await page.getByText('启动后自动连接').count(), 0)
    assert.ok(await page.getByText('切换线路时断开旧连接').isVisible())
    assert.equal(await page.getByLabel('切换线路时断开旧连接').count(), 1)
  },
)

await check(
  'duplicate notices merge and stay bottom-right',
  async ({ page, open, toasts }) => {
    await open('scenario=empty')
    await page.evaluate(async () => {
      const { showNotice } = await import('/src/services/notice-service.ts')
      showNotice.error('home.pewpew.connection.importFirst')
      showNotice.error('home.pewpew.connection.importFirst')
    })
    await page.waitForTimeout(400)
    assert.equal((await toasts()).length, 1)
    const box = await page.locator('.MuiAlert-filled').first().boundingBox()
    assert.ok(box.y > 350 && box.x > 400, JSON.stringify(box))
  },
)

await check(
  'wechat chip copies the support ID',
  async ({ page, open, toasts }) => {
    await open()
    await page.getByRole('button', { name: /微信 PewPew_VPN/ }).click()
    await page.waitForTimeout(400)
    assert.ok((await toasts()).some((t) => t.includes('已复制客服微信号')))
  },
)

const refetchAll = (page) =>
  page.evaluate(async () => {
    const { queryClient } = await import('/src/services/query-client.ts')
    await queryClient.invalidateQueries()
  })

await check(
  'switching to global keeps the route picked in Smart mode',
  async ({ page, open, toasts }) => {
    await open('scenario=connected&globalNow=DIRECT&ruleNow=🇯🇵 日本 01&slowIpc')
    await page.getByRole('button', { name: '全局模式', exact: true }).click()
    await page.waitForTimeout(2000)
    assert.equal(await groupNow(page, 'GLOBAL'), 'PewPew 云')
    assert.equal(await groupNow(page, 'PewPew 云'), '🇯🇵 日本 01')
    const picked = (await toasts()).filter((t) => t.includes('已自动切换到'))
    assert.equal(picked.length, 1, picked.join(' | '))
    assert.ok(picked[0].includes('日本 01'))
  },
)

await check(
  'an invalid route is repaired again after it reappears',
  async ({ page, open }) => {
    await open('scenario=connected&infoSelected=1')
    await page.waitForTimeout(1500)
    assert.equal(await groupNow(page, 'PewPew 云'), '🇭🇰 香港 01')
    // Emulate the tray picking the info node again.
    await page.evaluate(() => {
      window.homeTest.records['PewPew 云'].now = '剩余流量：86.42 GB'
    })
    await refetchAll(page)
    await page.waitForTimeout(1500)
    assert.equal(await groupNow(page, 'PewPew 云'), '🇭🇰 香港 01')
  },
)

await check(
  'connecting in direct mode switches to Smart mode first',
  async ({ page, open, state }) => {
    await open('mode=direct')
    assert.ok(
      await page
        .getByText('当前为直连模式，连接时会切换到智能模式')
        .isVisible(),
    )
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('已连接', { exact: true }).waitFor()
    assert.equal((await state()).config.mode, 'rule')
  },
)

await check(
  'a stale page cannot connect in direct mode after a tray change',
  async ({ page, open, state }) => {
    await open()
    await page.evaluate(() => {
      window.homeTest.state.config.mode = 'direct'
    })
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('已连接', { exact: true }).waitFor()
    assert.equal((await state()).config.mode, 'rule')
  },
)

await check(
  'a failure stays cleared after the tray connects and disconnects',
  async ({ page, open }) => {
    await open('coreDown=1')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    await page.evaluate(() => {
      const s = window.homeTest.state
      s.coreDown = false
      s.verge.enable_system_proxy = true
      s.system.enable = true
    })
    await refetchAll(page)
    await page.getByText('已连接', { exact: true }).waitFor({ timeout: 8000 })
    await page.evaluate(() => {
      const s = window.homeTest.state
      s.verge.enable_system_proxy = false
      s.system.enable = false
    })
    await refetchAll(page)
    await page.getByText('未连接', { exact: true }).waitFor({ timeout: 8000 })
    assert.equal(await page.getByText('连接失败', { exact: true }).count(), 0)
  },
)

await check(
  'disconnect stays available while connected data loads',
  async ({ page }) => {
    await page.goto(
      `${base}?theme=light&lang=zh&scenario=connected&slowProfiles=4000&slowProxies=4000`,
    )
    await page.waitForSelector('.pewpew-shell')
    await page.waitForTimeout(800)
    assert.equal(
      await page
        .getByRole('button', { name: '断开连接', exact: true })
        .isEnabled(),
      true,
    )
    assert.equal(await page.getByText('当前没有可用线路').count(), 0)
    assert.equal(await page.getByText('尚未导入线路').count(), 0)
  },
)

await check(
  'a profile read error keeps the connection card while connected',
  async ({ page }) => {
    await page.goto(
      `${base}?theme=light&lang=zh&scenario=connected&profilesError=1`,
    )
    await page.waitForSelector('.pewpew-shell')
    await page.waitForTimeout(6000)
    assert.ok(
      await page
        .getByRole('button', { name: '断开连接', exact: true })
        .isVisible(),
    )
  },
)

// Layout screenshots for the default (940x700) and minimum (520x520) windows.
for (const [name, query, width, height] of [
  ['ready-light-940', 'theme=light&lang=zh', 940, 700],
  ['ready-dark-940', 'theme=dark&lang=en', 940, 700],
  ['ready-light-520', 'theme=light&lang=zh', 520, 520],
  ['onboarding-dark-520', 'theme=dark&lang=en&scenario=empty', 520, 520],
  ['expired-light-940', 'theme=light&lang=zh&scenario=expired', 940, 700],
  ['long-dark-520', 'theme=dark&lang=en&long', 520, 520],
  ['ready-light-390', 'theme=light&lang=en', 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(`${base}?${query}`)
  await page.waitForSelector('.pewpew-shell')
  await page.waitForTimeout(1500)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  )
  results.push(`${overflow ? 'FAIL' : 'PASS'} no horizontal overflow: ${name}`)
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    animations: 'disabled',
  })
  if (width <= 520) {
    await page.locator('.pewpew-shell').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.screenshot({
      path: path.join(output, `${name}-bottom.png`),
      animations: 'disabled',
    })
    const subscription = page
      .getByRole('button', { name: /^(Update Routes|更新线路|Import Routes)$/ })
      .first()
    const bounds = await subscription.boundingBox()
    results.push(
      `${bounds && bounds.y >= 0 && bounds.y + bounds.height <= height ? 'PASS' : 'FAIL'} subscription controls reachable: ${name}`,
    )
  }
  await page.close()
}

console.log(results.join('\n'))
console.log(`screenshots: ${output}`)
await browser.close()
await server.close()
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1
