const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/outputDisconnect.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(compiled, { module: mod, exports: mod.exports })
const { EMPTY_OUTPUT_WATCH, deviceInUse, nextOutputWatch } = mod.exports

// What Chromium lists on Windows: aliases for the default and communications
// device, then the real outputs. A Bluetooth headset is two outputs in one group.
const speakers = { deviceId: 'spk', groupId: 'g-spk', label: 'Speakers (Realtek)' }
const phones = { deviceId: 'bt', groupId: 'g-bt', label: 'Headphones (WH-1000XM4 Stereo)' }
const handsFree = { deviceId: 'bt-hf', groupId: 'g-bt', label: 'Headset (WH-1000XM4 Hands-Free AG Audio)' }
const alias = (d) => ({ deviceId: 'default', groupId: d.groupId, label: `Default - ${d.label}` })
const comms = (d) => ({ deviceId: 'communications', groupId: d.groupId, label: `Communications - ${d.label}` })

const onPhones = [alias(phones), comms(handsFree), handsFree, phones, speakers]
const onSpeakers = [alias(speakers), comms(speakers), speakers]
const phonesBackNotDefault = [alias(speakers), comms(speakers), handsFree, phones, speakers]

function run(lists, { picked = '', playing = [] } = {}) {
  let watch = EMPTY_OUTPUT_WATCH
  return lists.map((list, i) => {
    const step = nextOutputWatch(watch, list, picked, playing[i] ?? false)
    watch = step.watch
    return step.action
  })
}

test('the default alias resolves to its real device by label, not the shared group', () => {
  assert.equal(deviceInUse(onPhones, '').deviceId, 'bt')
  assert.equal(deviceInUse(onSpeakers, '').deviceId, 'spk')
  assert.equal(deviceInUse(onPhones, 'spk').deviceId, 'spk')
  assert.equal(deviceInUse(onSpeakers, 'bt'), null)
})

test('falls back to the groupId when the alias label has no match', () => {
  const list = [{ deviceId: 'default', groupId: 'g-spk', label: 'Default' }, speakers]
  assert.equal(deviceInUse(list, '').deviceId, 'spk')
})

test('no device ids (no permission) never acts', () => {
  const blank = [{ deviceId: '', groupId: '', label: '' }]
  assert.deepEqual(run([blank, [], blank], { playing: [true, true, false] }), [null, null, null])
})

test('pauses when the default device disconnects mid-song and resumes when it is the output again', () => {
  assert.deepEqual(run([onPhones, onSpeakers, onPhones], { playing: [true, true, false] }), [null, 'pause', 'resume'])
})

test('reports the lost device by name', () => {
  const first = nextOutputWatch(EMPTY_OUTPUT_WATCH, onPhones, '', true)
  const second = nextOutputWatch(first.watch, onSpeakers, '', true)
  assert.equal(second.action, 'pause')
  assert.equal(second.watch.lostLabel, phones.label)
})

test('waits while the device is back but the system default stays on the speakers', () => {
  assert.deepEqual(
    run([onPhones, onSpeakers, phonesBackNotDefault, onPhones], { playing: [true, true, false, false] }),
    [null, 'pause', null, 'resume'],
  )
})

test('a device leaving while paused never starts anything', () => {
  assert.deepEqual(run([onPhones, onSpeakers, onPhones], { playing: [false, false, false] }), [null, null, null])
})

test('does not resume over a song that is already playing again', () => {
  assert.deepEqual(run([onPhones, onSpeakers, onPhones], { playing: [true, true, true] }), [null, 'pause', null])
})

test('a removal is still caught after a list where the default alias was missing', () => {
  const noAlias = [handsFree, phones, speakers]
  assert.deepEqual(run([onPhones, noAlias, onSpeakers], { playing: [true, true, true] }), [null, null, 'pause'])
})

test('a picked device pauses when it goes and resumes when it returns', () => {
  assert.deepEqual(
    run([onPhones, onSpeakers, phonesBackNotDefault], { picked: 'bt', playing: [true, true, false] }),
    [null, 'pause', 'resume'],
  )
})

test('another device leaving is ignored', () => {
  const withoutSpeakers = [alias(phones), comms(handsFree), handsFree, phones]
  assert.deepEqual(run([onPhones, withoutSpeakers], { playing: [true, true] }), [null, null])
})
