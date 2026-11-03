const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/lib/userApi.ts', 'utf8')
const block = source.slice(source.indexOf('export async function addSongsToPlaylist('), source.indexOf('export async function addPlaylistEntry(')).replaceAll("import('../store/useStore')", 'loadStore()')
function setup() {
  const calls = [], stored = { id: 7, items: [] }
  const env = { exports: {}, Set, IS_NATIVE_APP: true, LIBRARY_BASE: '/library', console,
    playlistDetailCache: new Map([[7, stored]]),
    getPlaylist: async () => stored,
    request: async (url, options) => { calls.push(['request', url, JSON.parse(options.body)]); return { added: [] } },
    applyPlaylistItemsAddResponse: async () => stored,
    loadStore: async () => ({ useStore: { getState: () => ({ autoDownloadIfOffline: (id, ids) => calls.push(['offline', id, Array.from(ids)]) }) } }),
  }
  vm.runInNewContext(ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, env)
  return { api: env.exports, calls, stored }
}
test('bulk additions deduplicate ids and sync downloaded playlists after the response merges', async () => {
  const { api, calls, stored } = setup()
  assert.equal(await api.addSongsToPlaylist(7, [4, 4, 9]), stored)
  await new Promise(setImmediate)
  assert.deepEqual(calls, [['request', '/library/playlists/7/items/', { song_ids: [4, 9] }], ['offline', 7, [4, 9]]])
})
test('single additions retain offline sync, and an empty batch does not write', async () => {
  const { api, calls, stored } = setup()
  assert.equal(await api.addToPlaylist(7, 4), stored)
  await new Promise(setImmediate)
  assert.deepEqual(calls[1], ['offline', 7, [4]])
  calls.length = 0
  assert.equal(await api.addSongsToPlaylist(7, []), stored)
  assert.deepEqual(calls, [])
})
