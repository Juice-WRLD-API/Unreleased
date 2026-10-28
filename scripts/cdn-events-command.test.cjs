const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), test = require('node:test'), ts = require('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function load(path, mocks = {}) {
  const module = { exports: {} }
  vm.runInNewContext(compile(path), { module, exports: module.exports, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name] } })
  return module.exports
}
const types = load('src/renderer/src/lib/terminal/types.ts')
function setup() {
  const calls = [], printed = []
  const api = { fetchCdnNodes: async () => [{ node_id: 'abcdef', name: 'My Node' }],
    fetchNodeEvents: async (...args) => { calls.push(args); return { events: [{ created_at: 'today', event_type: 'violation', actor_username: 'admin', detail: { reason: 'hash' } }], count: 51, page: args[1], has_next: true } } }
  const { CDN_COMMANDS } = load('src/renderer/src/lib/terminal/cdn.ts', { './types': types, '../cdnAdminApi': api, '../format': {}, '../../components/adminShared': {} })
  return { run: args => CDN_COMMANDS[0].run(args, { print: line => printed.push(line) }), calls, printed }
}
test('CDN event command resolves quoted node names and forwards page and filters', async () => {
  const s = setup(); await s.run('events "My Node" --page 2 --type approved,violation')
  assert.equal(s.calls[0][0], 'abcdef'); assert.equal(s.calls[0][1], 2)
  assert.deepEqual(Array.from(s.calls[0][2]), ['approved', 'violation'])
  assert.match(s.printed[0], /page 2.*--page 3/); assert.match(s.printed[0], /violation.*hash/)
})
test('CDN event command rejects invalid pages and missing node before requesting events', async () => {
  for (const args of ['events', 'events abc --page 0', 'events abc --page NaN', 'events abc --page 1.5']) {
    const s = setup(); await assert.rejects(s.run(args)); assert.equal(s.calls.length, 0)
  }
})
