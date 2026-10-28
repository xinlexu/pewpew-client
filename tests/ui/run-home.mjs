import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
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
const { version } = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
)
const [major, minor, patch] = version.split('.').map(Number)
const updateVersion = `${major}.${minor}.${patch + 1}`
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
const filter = process.env.PEWPEW_UI_FILTER
  ? new RegExp(process.env.PEWPEW_UI_FILTER)
  : null
const check = async (name, fn) => {
  if (filter && !filter.test(name)) return
  const page = await browser.newPage({ viewport: { width: 940, height: 700 } })
  const errors = []
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(60000)
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

await check(
  'manual route selection cancels Discord optimization first',
  async ({ page, open }) => {
    await open('scenario=enhanced')
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: /香港 02/ }).click()
    await page.waitForFunction(() =>
      window.homeTest.calls.some(
        (call) =>
          call.command === 'plugin:mihomo|select_node_for_group' &&
          call.args.node === '🇭🇰 香港 02',
      ),
    )
    const commands = await page.evaluate(() =>
      window.homeTest.calls.map((call) => call.command),
    )
    assert.ok(commands.indexOf('follow_manual_discord_route') >= 0)
    assert.ok(
      commands.indexOf('follow_manual_discord_route') <
        commands.indexOf('plugin:mihomo|select_node_for_group'),
    )
  },
)

await check(
  'failed Discord reset does not apply a contradictory manual route',
  async ({ page, open }) => {
    await open('scenario=enhanced&discordResetFails')
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: /香港 02/ }).click()
    await page.getByText('线路切换失败，请稍后重试或联系客服').waitFor()
    const commands = await page.evaluate(() =>
      window.homeTest.calls.map((call) => call.command),
    )
    assert.equal(
      commands.includes('plugin:mihomo|select_node_for_group'),
      false,
    )
  },
)

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
    // The busy state renders a moment after the request starts; it must
    // arrive while the 700 ms selection is still pending.
    for (const control of [
      page.getByRole('button', { name: '连接', exact: true }),
      page.getByRole('button', { name: '导入线路', exact: true }),
      page.getByRole('combobox'),
    ]) {
      await control
        .and(page.locator(':disabled, [aria-disabled="true"]'))
        .waitFor({ timeout: 500 })
    }
    assert.equal((await state()).config.mode, 'rule')
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

for (const [error, notice] of [
  [
    'pewpew-service-install-failed (code 1): Access is denied.',
    '后台服务安装失败',
  ],
  ['pewpew-service-install-cancelled', '需要系统授权才能使用增强兼容'],
]) {
  await check(
    `enhanced connect explains a service install problem: ${notice}`,
    async ({ page, open, toasts }) => {
      await open(
        `enhancedMode&accepted&prepareError=${encodeURIComponent(error)}`,
      )
      await page.getByRole('button', { name: '连接', exact: true }).click()
      await page.getByText('连接失败', { exact: true }).waitFor()
      const list = await toasts()
      assert.ok(
        list.some((t) => t.includes(notice)),
        list.join(' | '),
      )
    },
  )
}

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

const clipboardWrites = (page) =>
  page.evaluate(() =>
    window.homeTest.calls
      .filter((c) => c.command === 'plugin:clipboard-manager|write_text')
      .map((c) => c.args.text),
  )
const commandsIn = (page, names) =>
  page.evaluate(
    (list) =>
      window.homeTest.calls
        .map((c) => c.command)
        .filter((c) => list.includes(c)),
    names,
  )

await check('wechat chip opens the support QR code', async ({ page, open }) => {
  await open()
  await page.getByRole('button', { name: /微信 PewPew_VPN/ }).click()
  const dialog = page.getByRole('dialog', { name: '添加客服微信' })
  const qr = dialog.getByRole('img', { name: '微信扫一扫，添加客服为好友' })
  await qr.waitFor()
  assert.ok(await qr.evaluate((img) => img.complete && img.naturalWidth > 0))
  await dialog.getByRole('button', { name: '复制微信号' }).click()
  await dialog.getByRole('button', { name: '已复制' }).waitFor()
  assert.deepEqual(await clipboardWrites(page), ['PewPew_VPN'])
})

await check(
  'feedback copies the diagnostics and shows the QR code',
  async ({ page, open }) => {
    await open('otherApps=Clash Verge')
    await page.getByRole('button', { name: '反馈问题' }).click()
    const dialog = page.getByRole('dialog', { name: '反馈问题' })
    await dialog.getByText('诊断信息已复制到剪贴板').waitFor()
    const [text] = await clipboardWrites(page)
    assert.match(text, /Local proxy port: 7966 \(listening\)/)
    assert.match(text, /Other proxy apps: Clash Verge/)
    assert.doesNotMatch(text, /Voice/)
    assert.ok(
      await dialog
        .getByRole('img', { name: '微信扫一扫，添加客服为好友' })
        .isVisible(),
    )
  },
)

await check(
  'connection check lists the proxy port and other apps, not voice',
  async ({ page, open }) => {
    await open('scenario=connected&otherApps=Clash Verge')
    await page.getByRole('button', { name: '检查连接' }).click()
    const dialog = page.getByRole('dialog', { name: '检查连接' })
    await dialog.getByText('7966 正常').waitFor()
    assert.ok(
      await dialog.getByText('其他代理软件', { exact: true }).isVisible(),
    )
    assert.ok(
      await dialog
        .getByText(/检测到其他代理软件正在运行：Clash Verge/)
        .isVisible(),
    )
    assert.equal(await dialog.getByText('语音连通性').count(), 0)
  },
)

await check(
  'another proxy app is mentioned before connecting',
  async ({ page, open, state }) => {
    await open('otherApps=Clash Verge')
    const connect = page.getByRole('button', { name: '连接', exact: true })
    const dialog = page.getByRole('dialog', { name: '检测到可能的冲突' })
    await connect.click()
    await dialog.getByText(/检测到其他代理软件正在运行：Clash Verge/).waitFor()
    await dialog.getByRole('button', { name: '取消' }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal((await state()).system.enable, false)
    assert.equal(await page.getByText('连接失败', { exact: true }).count(), 0)

    await connect.click()
    await dialog.getByRole('button', { name: '仍然连接' }).click()
    await page.getByText('已连接', { exact: true }).waitFor()

    // The same app is not asked about again in this session.
    await page.getByRole('button', { name: '断开连接', exact: true }).click()
    await page.getByText('未连接', { exact: true }).waitFor()
    await connect.click()
    await page.getByText('已连接', { exact: true }).waitFor()
    assert.equal(
      (await commandsIn(page, ['detect_proxy_conflicts'])).length >= 3,
      true,
    )
  },
)

await check(
  'a taken proxy port moves to a free one before connecting',
  async ({ page, open, state, toasts }) => {
    await open('portBusy')
    await page.getByRole('button', { name: '连接', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '检测到可能的冲突' })
    await dialog.getByText(/本地代理端口 7966 已被其他程序占用/).waitFor()
    await dialog.getByRole('button', { name: '换端口并连接' }).click()
    await page.getByText('已连接', { exact: true }).waitFor()
    const after = await state()
    assert.equal(after.verge.verge_mixed_port, 7969)
    assert.equal(after.config.mixedPort, 7969)
    assert.equal(after.system.server, '127.0.0.1:7969')
    assert.ok(
      (await toasts()).some((t) => t.includes('端口 7966 被占用，已改用 7969')),
    )
    const patches = await commandsIn(page, [
      'patch_clash_config',
      'patch_verge_config',
    ])
    assert.equal(patches[0], 'patch_clash_config')
  },
)

await check(
  'no free proxy port stops the connection with a clear notice',
  async ({ page, open, state, toasts }) => {
    await open('portBusy&noFreePort')
    await page.getByRole('button', { name: '连接', exact: true }).click()
    await page
      .getByRole('dialog', { name: '检测到可能的冲突' })
      .getByRole('button', { name: '换端口并连接' })
      .click()
    await page.getByText('连接失败', { exact: true }).waitFor()
    assert.equal((await state()).system.enable, false)
    assert.ok((await toasts()).some((t) => t.includes('没有找到空闲端口')))
  },
)

const openSpeedTest = async (page) => {
  await page.getByRole('button', { name: '测速', exact: true }).click()
  return page.getByRole('dialog', { name: '线路测速' })
}

await check(
  'the speed test shows the route speed and the data it used',
  async ({ page, open }) => {
    await open()
    assert.equal(
      await page.getByRole('button', { name: '测速', exact: true }).count(),
      0,
      'speed test is only offered while connected',
    )
    await page.goto('about:blank')
    await open('scenario=connected')
    const dialog = await openSpeedTest(page)
    await dialog.getByText('186', { exact: true }).waitFor()
    assert.ok(await dialog.getByText('用掉约 150 MB 流量').isVisible())
    assert.ok(
      await dialog.getByRole('button', { name: '再测一次' }).isEnabled(),
    )
    assert.equal(await dialog.getByText(/没有经过线路/).count(), 0)
  },
)

await check('closing a running speed test stops it', async ({ page, open }) => {
  await open('scenario=connected&speedSlow')
  const dialog = await openSpeedTest(page)
  await dialog.getByText('正在测速…').waitFor()
  await dialog.getByRole('button', { name: '停止' }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await commandsIn(page, ['cancel_speed_test']), [
    'cancel_speed_test',
  ])
})

await check(
  'a speed test that the rules send direct says so',
  async ({ page, open }) => {
    await open('scenario=connected&speedDirect')
    const dialog = await openSpeedTest(page)
    await dialog.getByText(/没有经过线路/).waitFor()
  },
)

await check('a failed speed test can be retried', async ({ page, open }) => {
  await open('scenario=connected&speedFails')
  const dialog = await openSpeedTest(page)
  await dialog.getByText('测速失败。请确认已经连接，稍后再试。').waitFor()
  await dialog.getByRole('button', { name: '再测一次' }).click()
  await dialog.getByText('测速失败。请确认已经连接，稍后再试。').waitFor()
  assert.equal((await commandsIn(page, ['run_speed_test'])).length, 2)
})

await check(
  'reopening a cancelled speed test waits for the previous run',
  async ({ page, open }) => {
    await open('scenario=connected&speedSlow&speedCancelSlow')
    const dialog = await openSpeedTest(page)
    await page.waitForFunction(() =>
      window.homeTest.calls.some((c) => c.command === 'run_speed_test'),
    )
    await dialog.getByRole('button', { name: '停止' }).click()
    await dialog.waitFor({ state: 'hidden' })
    const reopened = await openSpeedTest(page)
    await reopened.getByText('186', { exact: true }).waitFor()
    assert.equal(
      await reopened.getByText('测速失败。请确认已经连接，稍后再试。').count(),
      0,
    )
  },
)

const openAbout = async (page) => {
  await page.getByRole('button', { name: '关于', exact: true }).click()
  return page.getByRole('dialog', { name: '关于 / 开源许可' })
}

await check(
  'an update is downloaded, then the network is restored, then installed',
  async ({ page, open }) => {
    await open(`update=${updateVersion}`)
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByText(`发现新版本 ${updateVersion}`).waitFor()
    // The header sits behind the open dialog, so it is aria-hidden for now.
    assert.equal(
      await page
        .getByRole('button', { name: '关于 · 有新版本', includeHidden: true })
        .count(),
      1,
    )
    await about.getByRole('button', { name: '查看' }).click()
    const dialog = page.getByRole('dialog', { name: `更新到 ${updateVersion}` })
    await dialog.getByText('修复与 Clash Verge 同时运行时全部超时').waitFor()
    await dialog.getByRole('button', { name: '立即更新' }).click()
    await dialog.getByText('正在安装，客户端会自动重启…').waitFor()
    assert.deepEqual(
      await commandsIn(page, [
        'plugin:updater|download',
        'prepare_update_install',
        'plugin:updater|install',
        'restart_app',
      ]),
      [
        'plugin:updater|download',
        'prepare_update_install',
        'plugin:updater|install',
        'restart_app',
      ],
    )
    const checkArgs = await page.evaluate(
      () =>
        window.homeTest.calls.find((c) => c.command === 'plugin:updater|check')
          .args,
    )
    assert.equal(checkArgs.proxy, 'http://127.0.0.1:7966')
  },
)

await check(
  'a background check marks About and mentions the new version once',
  async ({ page, open, toasts }) => {
    await open(`update=${updateVersion}`)
    const about = page.getByRole('button', { name: '关于 · 有新版本' })
    await about.waitFor({ timeout: 15000 })
    assert.ok(
      (await toasts()).some((t) => t.includes(`发现新版本 ${updateVersion}`)),
    )
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem('pewpew-update-notified-version'),
      ),
      updateVersion,
    )
  },
)

await check(
  'daily update checks continue without restarting the client',
  async ({ page, open }) => {
    await page.clock.install()
    await open()
    await page.clock.fastForward(10_000)
    await page.waitForFunction(() =>
      window.homeTest.calls.some((c) => c.command === 'plugin:updater|check'),
    )
    await page.waitForTimeout(100)
    const before = (await commandsIn(page, ['plugin:updater|check'])).length
    await page.clock.fastForward(24 * 60 * 60 * 1000 + 10_000)
    await page.waitForFunction(
      (count) =>
        window.homeTest.calls.filter(
          (c) => c.command === 'plugin:updater|check',
        ).length > count,
      before,
    )
  },
)

await check(
  'cleanup failure never starts the installer',
  async ({ page, open }) => {
    await open(`update=${updateVersion}&cleanupFails`)
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByRole('button', { name: '查看' }).click()
    const dialog = page.getByRole('dialog', { name: `更新到 ${updateVersion}` })
    await dialog.getByRole('button', { name: '立即更新' }).click()
    await page.waitForFunction(() =>
      window.homeTest.calls.some((c) => c.command === 'prepare_update_install'),
    )
    await page.waitForTimeout(200)
    assert.deepEqual(await commandsIn(page, ['plugin:updater|install']), [])
    assert.deepEqual(await commandsIn(page, ['restart_app']), ['restart_app'])
  },
)

await check(
  'failed update recovery leaves a usable dialog',
  async ({ page, open }) => {
    await open(`update=${updateVersion}&installFails&restartFails`)
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByRole('button', { name: '查看' }).click()
    const dialog = page.getByRole('dialog', { name: `更新到 ${updateVersion}` })
    await dialog.getByRole('button', { name: '立即更新' }).click()
    await page.waitForFunction(() =>
      window.homeTest.calls.some((c) => c.command === 'restart_app'),
    )
    await dialog
      .getByText('自动重启失败，请从托盘退出后重新打开客户端')
      .waitFor()
    await dialog.getByRole('button', { name: '重启客户端' }).click()
    await page.waitForFunction(
      () =>
        window.homeTest.calls.filter((c) => c.command === 'restart_app')
          .length === 2,
    )
    assert.equal((await commandsIn(page, ['plugin:updater|install'])).length, 1)
    await dialog.getByRole('button', { name: '稍后' }).click()
    await dialog.waitFor({ state: 'hidden' })
  },
)

await check(
  'the About dialog reports an up-to-date client',
  async ({ page, open }) => {
    await open()
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByText('已是最新版本').waitFor()
  },
)

await check(
  'a failed update check tries the proxy, then direct, then says so',
  async ({ page, open }) => {
    await open('updateCheckFails')
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByText('检查更新失败，请稍后再试').waitFor()
    const proxies = await page.evaluate(() =>
      window.homeTest.calls
        .filter((c) => c.command === 'plugin:updater|check')
        .map((c) => c.args.proxy ?? null),
    )
    assert.deepEqual(proxies, ['http://127.0.0.1:7966', null])
  },
)

await check(
  'an installer that does not start restarts the client to restore it',
  async ({ page, open, toasts }) => {
    await open(`update=${updateVersion}&installFails`)
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByRole('button', { name: '查看' }).click()
    await page
      .getByRole('dialog', { name: `更新到 ${updateVersion}` })
      .getByRole('button', { name: '立即更新' })
      .click()
    await page.waitForFunction(() =>
      window.homeTest.calls.some((c) => c.command === 'restart_app'),
    )
    assert.ok((await toasts()).some((t) => t.includes('安装程序没有启动')))
  },
)

await check(
  'a failed download keeps the client running and offers a retry',
  async ({ page, open }) => {
    await open(`update=${updateVersion}&downloadFails`)
    const about = await openAbout(page)
    await about.getByRole('button', { name: '检查更新' }).click()
    await about.getByRole('button', { name: '查看' }).click()
    const dialog = page.getByRole('dialog', { name: `更新到 ${updateVersion}` })
    await dialog.getByRole('button', { name: '立即更新' }).click()
    await dialog.getByText('下载更新失败，请检查网络后重试').waitFor()
    assert.ok(await dialog.getByRole('button', { name: '重试' }).isEnabled())
    assert.deepEqual(
      await commandsIn(page, [
        'prepare_update_install',
        'plugin:updater|install',
      ]),
      [],
    )
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
  if (filter) break
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
