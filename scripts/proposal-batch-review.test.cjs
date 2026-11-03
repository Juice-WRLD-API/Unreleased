const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, globals = {}, names) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src', relative), 'utf8')
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  const input = names ? ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n') : source
  const compiled = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, ...globals })
  return exports
}

for (const kind of ['song', 'comp']) {
  for (const action of ['approve', 'reject']) {
    test(`${kind} batch ${action} sends one POST and retains partial failures`, async () => {
      const calls = []
      const response = { results: [{ id: 7, result: 'failed', detail: 'conflict' }], summary: { failed: 1 } }
      const name = kind === 'song' ? 'adminReviewProposalsBatch' : 'adminReviewCompProposalsBatch'
      let guards = 0
      const api = load('lib/userApi.ts', {
        ACCOUNT_BASE: 'https://example.test/accounts',
        assertContributorApi: () => { guards++ },
        request: async (url, options) => { calls.push({ url, options }); return response },
      }, [name])
      assert.equal(await api[name]([7, 8], action, 'legacy'), response)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, `https://example.test/accounts/admin/${kind === 'song' ? 'proposals' : 'comp-proposals'}/batch/review/`)
      assert.equal(calls[0].options.method, 'POST')
      assert.deepEqual(JSON.parse(calls[0].options.body), { ids: [7, 8], action, channel: 'legacy', stop_on_error: false })
      assert.equal(guards, kind === 'comp' ? 1 : 0)
    })
  }
}

test('batch transport errors reach the caller', async () => {
  const error = new Error('offline')
  const api = load('lib/userApi.ts', { ACCOUNT_BASE: '/accounts', request: async () => { throw error } }, ['adminReviewProposalsBatch'])
  await assert.rejects(api.adminReviewProposalsBatch([7], 'approve'), e => e === error)
})

for (const action of ['approve', 'reject']) {
  test(`comp queue batch ${action} applies successes and reports failures`, async () => {
    const states = []
    const calls = []
    const toasts = []
    let refreshed = 0
    const react = {
      useCallback: fn => fn,
      useEffect: () => {},
      useState: value => { const slot = { value }; states.push(slot); return [value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }] },
    }
    const api = { adminReviewCompProposalsBatch: async (...args) => {
      calls.push(args)
      return { results: [{ id: 7, result: 'approved', proposal: { id: 7, status: 'approved' } }, { id: 8, result: 'failed', detail: 'conflict' }] }
    } }
    const hook = load('hooks/useCompProposalsQueue.ts', { require: name => {
      if (name === 'react') return react
      if (name === '../lib/userApi') return api
      if (name === '../lib/appToast') return { showAppToast: text => toasts.push(text) }
      if (name === '../lib/format') return { errorMessage: e => e.message }
      throw new Error(name)
    } }).useCompProposalsQueue('legacy', () => { refreshed++ }, true)
    states[1].value = [{ id: 7, status: 'pending' }, { id: 8, status: 'pending' }]
    await hook.doReviewAll([7, 8], action)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1], action)
    assert.equal(calls[0][2], 'legacy')
    assert.deepEqual(states[1].value.map(p => p.id), [8])
    assert.match(toasts[0], /1 proposals weren't reviewed.*conflict/)
    assert.equal(refreshed, 1)
    assert.equal(states.at(-1).value, false)
  })
}
for (const kind of ['song', 'comp']) {
  test(`terminal review-batch routes ${kind} ids and channel, and reports item errors`, async () => {
    const calls = []
    const output = []
    const api = {
      adminReviewProposalsBatch: async (...args) => { calls.push(['song', ...args]); return { summary: { rejected: 1, failed: 1 }, results: [{ id: 8, result: 'failed', detail: 'conflict' }] } },
      adminReviewCompProposalsBatch: async (...args) => { calls.push(['comp', ...args]); return { summary: { rejected: 1, failed: 1 }, results: [{ id: 8, result: 'failed', detail: 'conflict' }] } },
    }
    const types = load('lib/terminal/types.ts')
    const commands = load('lib/terminal/admin.ts', { require: name => {
      if (name === '../userApi') return api
      if (name === './types') return types
      return {}
    } }).ADMIN_COMMANDS
    const command = commands.find(c => c.name === 'review-batch')
    await command.run(`reject ${kind} 7,8,7 --channel legacy -y`, { scripted: false, print: (text, tone) => output.push({ text, tone }) })
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], kind)
    assert.equal(calls[0][1].join(','), '7,8')
    assert.equal(calls[0][2], 'reject')
    assert.equal(calls[0][3], 'legacy')
    assert.match(output[0].text, /rejected: 1/)
    assert.deepEqual(output[1], { text: '#8 failed: conflict', tone: 'error' })
    await assert.rejects(command.run(`approve ${kind} 7, -y`, {}), /positive proposal ids/)
    await assert.rejects(command.run(`revise ${kind} 7 -y`, {}), /usage/)
    assert.equal(calls.length, 1)
  })
}
