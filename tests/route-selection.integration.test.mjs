import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { resolvePewPewProxyGroup } from '../src/utils/pewpew-client.ts'
import { applyRouteSelection } from '../src/utils/route-selection.ts'

const core = process.env.PEWPEW_TEST_CORE

test('nested selection reaches the intended leaf in the bundled connection core', {
  skip: !core,
  timeout: 20000,
}, async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const temp = await mkdtemp(path.join(tmpdir(), 'pewpew-route-test-'))
  const config = path.join(temp, 'config.yaml')
  await writeFile(
    config,
    `mixed-port: 0
external-controller: 127.0.0.1:${port}
secret: local-regression-test
mode: rule
log-level: warning
proxies:
  - {name: Paris, type: socks5, server: 127.0.0.1, port: 9}
  - {name: Tokyo, type: socks5, server: 127.0.0.1, port: 9}
proxy-groups:
  - {name: Proxy, type: select, proxies: [Paris, Region]}
  - {name: Region, type: select, proxies: [Paris, Tokyo]}
rules:
  - MATCH,Proxy
`,
  )
  const child = spawn(core, ['-d', temp, '-f', config], {
    windowsHide: true,
    stdio: 'ignore',
  })
  const exited = once(child, 'exit')
  const request = async (url, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      ...options,
      headers: {
        Authorization: 'Bearer local-regression-test',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(1000),
    })
    assert.equal(
      response.ok,
      true,
      `${options.method || 'GET'} ${url}: ${response.status}`,
    )
    return response
  }
  try {
    let data
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        data = await (await request('/proxies')).json()
        break
      } catch {
        if (child.exitCode !== null) break
        await delay(100)
      }
    }
    assert.ok(data, 'the isolated core must start')
    const result = resolvePewPewProxyGroup({ records: data.proxies })
    const tokyo = result.options.find((item) => item.name === 'Tokyo')
    assert.ok(tokyo?.selectionPath)
    await applyRouteSelection(tokyo.selectionPath, (group, proxy) =>
      request(`/proxies/${encodeURIComponent(group)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: proxy }),
      }),
    )
    const after = await (await request('/proxies')).json()
    assert.equal(after.proxies.Proxy.now, 'Region')
    assert.equal(after.proxies.Region.now, 'Tokyo')
    assert.equal(
      resolvePewPewProxyGroup({ records: after.proxies }).currentName,
      'Tokyo',
    )
  } finally {
    child.kill()
    await exited
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(tmpdir()))
    await rm(temp, { recursive: true, force: true })
  }
})
