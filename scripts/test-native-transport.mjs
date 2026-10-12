import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/renderer/src/lib/nativeSession.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { NativeSessionTransport } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const tick = () => new Promise((r) => setImmediate(r))
function setup() {
  const commands = [], errors = [], listeners = new Set()
  let finishOpen
  const open = new Promise((r) => { finishOpen = r })
  globalThis.window = { electron: {
    platform: 'win32', sessionNativeOpen: () => open,
    sessionNativeCommand: async (id, command, channels) => { commands.push({ id, ...command, channels }); return {} },
    sessionNativeClose: async () => { commands.push({ op: 'close' }) },
    onSessionNativeEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  } }
  return { commands, errors, listeners, finishOpen, transport: new NativeSessionTransport((error) => errors.push(error)) }
}
const asset = { id: 'a', buffer: { sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(64) } }

test('pause during startup cancels the queued play', async () => {
  const { transport, finishOpen, commands } = setup()
  transport.play({}, [asset], 0, 'mix')
  await tick()
  transport.pause()
  finishOpen({})
  await tick(); await tick()
  assert.equal(commands.some((c) => c.op === 'play'), false)
  assert.equal(commands.some((c) => c.op === 'pause'), true)
  transport.dispose()
})

test('rapid seek keeps only the latest queued play and caches its assets', async () => {
  const { transport, finishOpen, commands } = setup()
  transport.play({}, [asset], 1, 'mix')
  transport.play({}, [asset], 2, 'mix')
  finishOpen({})
  await tick(); await tick()
  assert.deepEqual(commands.filter((c) => c.op === 'play').map((c) => c.from), [2])
  transport.play({}, [asset], 3, 'mix')
  await tick(); await tick()
  assert.equal(commands.filter((c) => c.op === 'asset').length, 1)
  assert.equal(commands.filter((c) => c.op === 'play').at(-1).from, 3)
  transport.dispose()
})

test('dispose during opening prevents assets or playback being sent', async () => {
  const { transport, finishOpen, commands, listeners } = setup()
  transport.play({}, [asset], 0, 'mix')
  await tick(); transport.dispose(); finishOpen({}); await tick()
  assert.deepEqual(commands.map((c) => c.op), ['close'])
  assert.equal(listeners.size, 0)
})

test('mix changes coalesce to the latest project while opening', async () => {
  const { transport, finishOpen, commands } = setup()
  transport.play({}, [asset], 0, 'mix')
  transport.mix({ masterGain: .8 }); transport.mix({ masterGain: .3 })
  finishOpen({}); await tick(); await tick()
  assert.deepEqual(commands.filter((c) => c.op === 'mix').map((c) => c.project), [{ masterGain: .3 }])
  transport.dispose()
})
