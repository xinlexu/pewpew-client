import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyConnectionChange,
  applyDisconnect,
  connectionMatches,
  connectionMode,
  connectionPatch,
  createConnectionQueue,
} from '../src/utils/connection-state.ts'

test('standard connections never leave enhanced routing enabled', () => {
  assert.deepEqual(connectionPatch(true, 'standard'), {
    enable_system_proxy: true,
    enable_tun_mode: false,
  })
})

test('enhanced connections include system proxy and TUN', () => {
  assert.deepEqual(connectionPatch(true, 'enhanced'), {
    enable_system_proxy: true,
    enable_tun_mode: true,
  })
})

test('disconnect disables both modes without forgetting the preference', () => {
  assert.deepEqual(connectionPatch(false, 'enhanced'), {
    enable_system_proxy: false,
    enable_tun_mode: false,
  })
  assert.equal(
    connectionMode({
      enable_tun_mode: false,
      pewpew_enhanced_mode: true,
    }),
    'enhanced',
  )
  assert.equal(connectionMode({}), 'standard')
  assert.equal(connectionMode({ enable_tun_mode: true }), 'enhanced')
})

test('system proxy success alone cannot verify enhanced connectivity', () => {
  const expected = connectionPatch(true, 'enhanced')
  assert.equal(
    connectionMatches(expected, { systemProxy: true, tun: false }),
    false,
  )
  assert.equal(
    connectionMatches(expected, { systemProxy: true, tun: true }),
    true,
  )
  assert.equal(
    connectionMatches(connectionPatch(false, 'enhanced'), {
      systemProxy: false,
      tun: true,
    }),
    false,
  )
})

test('failed verification restores and verifies the previous configuration', async () => {
  const previous = connectionPatch(true, 'standard')
  const desired = connectionPatch(true, 'enhanced')
  const applied = []
  const verified = []
  await assert.rejects(
    applyConnectionChange(
      desired,
      previous,
      async (value) => {
        applied.push(value)
      },
      async (value) => {
        verified.push(value)
        if (value === desired) throw new Error('TUN failed')
      },
    ),
    /TUN failed/,
  )
  assert.deepEqual(applied, [desired, previous])
  assert.deepEqual(verified, [desired, previous])
})

test('permission and apply failures do not report a successful connection', async () => {
  const previous = connectionPatch(false, 'standard')
  const desired = connectionPatch(true, 'enhanced')
  const applied = []
  await assert.rejects(
    applyConnectionChange(
      desired,
      previous,
      async (value) => {
        applied.push(value)
        if (value === desired) throw new Error('permission denied')
      },
      async () => {},
    ),
    /permission denied/,
  )
  assert.deepEqual(applied, [desired, previous])
})

test('failed rollback remains an explicit error', async () => {
  await assert.rejects(
    applyConnectionChange(
      connectionPatch(true, 'enhanced'),
      connectionPatch(false, 'standard'),
      async () => {
        throw new Error('core unavailable')
      },
      async () => {},
    ),
    /rollback-failed/,
  )
})

test('disconnect clears the system proxy before stopping TUN', async () => {
  const calls = []
  await applyDisconnect(true, async (patch) => {
    calls.push(patch)
  })
  assert.deepEqual(calls, [
    { enable_system_proxy: false },
    { enable_tun_mode: false },
  ])
})

test('a failed TUN disconnect never re-enables the system proxy', async () => {
  const calls = []
  await assert.rejects(
    applyDisconnect(true, async (patch) => {
      calls.push(patch)
      if ('enable_tun_mode' in patch) throw new Error('core unavailable')
    }),
    /core unavailable/,
  )
  assert.equal(calls.length, 2)
  assert.equal(
    calls.some((patch) => patch.enable_system_proxy === true),
    false,
  )
})

test('connection operations serialize and recover after a rejected operation', async () => {
  const queue = createConnectionQueue()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const events = []
  const first = queue(async () => {
    events.push('first-start')
    await gate
    events.push('first-end')
    throw new Error('denied')
  })
  const rejected = assert.rejects(first, /denied/)
  const second = queue(async () => {
    events.push('second')
    return 2
  })
  await Promise.resolve()
  assert.deepEqual(events, ['first-start'])
  release()
  await rejected
  assert.equal(await second, 2)
  assert.deepEqual(events, ['first-start', 'first-end', 'second'])
})
