/**
 * dsh-expert-council — Client half smoke tests.
 *
 * Loads `client.js` in a stub `window.__ModuleLoader__` capture, runs the lazy
 * factory with a tiny fake `react`, and calls `apply` with a fake plugin
 * context whose `slots`, `locale` and `effect` services are recording stubs.
 *
 * No dependencies: Node's built-in `node:test` and `node:assert` only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const source = readFileSync(clientPath, 'utf8')

const CJK_PATTERN = /[\u3400-\u9fff]/

/** Loads `client.js` and returns the single module spec handed to the loader. */
function loadModuleSpec() {
  const captured = []
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        captured.push(spec)
      },
    },
  }
  try {
    // Plain browser script: executing it only calls the module loader.
    new Function('window', source)(globalThis.window)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  assert.equal(captured.length, 1, 'the loader must be called exactly once')
  return captured[0]
}

/** Minimal React: enough for module definition and the pure icon component. */
function createReactStub() {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    memo(component) {
      return component
    },
  }
  return react
}

/** Recording fake of the Cordis-style plugin context used by `apply`. */
function createFakeContext() {
  const state = {
    injections: [],
    registrations: [],
    effects: [],
    locales: [],
  }

  const ctx = {
    effect(fn, label) {
      state.effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(name, callback) {
        state.injections.push(name)
        return callback()
      },
      register(definition, component) {
        state.registrations.push({ definition, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        state.locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => {
          const entry = state.locales.find((item) => item.namespace === namespace)
          if (!entry) return key
          const dictionaries = entry.dictionaries || {}
          const dictionary = dictionaries.zh || {}
          return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
        }
      },
    },
  }

  return { ctx, state }
}

function applyPlugin() {
  const spec = loadModuleSpec()
  const react = createReactStub()
  const requested = []
  const plugin = spec.factory((name) => {
    requested.push(name)
    assert.equal(name, 'react', 'the factory should only require react')
    return react
  })
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  return { spec, plugin, state, requested }
}

function findRegistration(state, name) {
  return state.registrations.find((entry) => entry.definition && entry.definition.name === name)
}

test('module spec is the frozen client identity', () => {
  const spec = loadModuleSpec()
  assert.equal(spec.id, 'dsh-expert-council')
  assert.equal(typeof spec.factory, 'function')
})

test('apply registers the sidebar rail entry and the main panel', () => {
  const { plugin, state, requested } = applyPlugin()
  assert.deepEqual(requested, ['react'])
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(state.effects.length, 1)
  assert.deepEqual(state.injections, ['sidebar.panellist', 'main'])
  assert.equal(state.registrations.length, 2)

  const sidebar = findRegistration(state, 'sidebar.panellist')
  assert.ok(sidebar, 'sidebar.panellist must be registered')
  assert.equal(sidebar.definition.id, 'dsh-expert-council')
  assert.equal(sidebar.definition.order, 31)
  assert.equal(sidebar.definition.locale, 'dshExpertCouncil')
  assert.equal(typeof sidebar.definition.label, 'function')
  assert.equal(sidebar.definition.label(), '专家团')
  assert.equal(typeof sidebar.component, 'function')

  const main = findRegistration(state, 'main')
  assert.ok(main, 'main must be registered')
  assert.equal(main.definition.key, 'dsh-expert-council')
  assert.equal(main.definition.locale, 'dshExpertCouncil')
  assert.equal(typeof main.component, 'function')
  assert.doesNotThrow(() => main.component({}))
})

test('sidebar icon renders a crisp currentColor council glyph', () => {
  const { state } = applyPlugin()
  const sidebar = findRegistration(state, 'sidebar.panellist')
  const element = sidebar.component({ size: 18 })
  assert.equal(element.type, 'svg')
  assert.equal(element.props.width, 18)
  assert.equal(element.props.height, 18)
  assert.equal(element.props.viewBox, '0 0 24 24')
  assert.equal(element.props['aria-hidden'], true)
  assert.ok(element.children.length >= 5, 'three figures plus the table marker')
  const serialized = JSON.stringify(element)
  assert.ok(serialized.includes('currentColor'), 'the figures follow the current color')
  assert.ok(serialized.includes('#6d8df0'), 'the cool accent is present')
})

test('locale dictionaries cover zh and en with identical key sets', () => {
  const { state } = applyPlugin()
  assert.equal(state.locales.length, 1)

  const entry = state.locales[0]
  assert.equal(entry.namespace, 'dshExpertCouncil')
  const zh = entry.dictionaries && entry.dictionaries.zh
  const en = entry.dictionaries && entry.dictionaries.en
  assert.ok(zh && typeof zh === 'object', 'zh dictionary must exist')
  assert.ok(en && typeof en === 'object', 'en dictionary must exist')

  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en must cover the same key set')
  assert.ok(zhKeys.length >= 100, `expected a complete dictionary, got ${zhKeys.length} keys`)

  for (const key of zhKeys) {
    assert.equal(typeof zh[key], 'string', `zh.${key} must be a string`)
    assert.ok(zh[key].length > 0, `zh.${key} must not be empty`)
    assert.equal(typeof en[key], 'string', `en.${key} must be a string`)
    assert.ok(en[key].length > 0, `en.${key} must not be empty`)
  }

  assert.equal(zh.panel, '专家团')
  assert.equal(en.panel, 'Expert Council')
  assert.equal(zh.lang, 'zh')
  assert.equal(en.lang, 'en')
  for (const key of ['title', 'convene', 'questionLabel', 'sectionVerdict', 'archive', 'statusOpen']) {
    assert.ok(CJK_PATTERN.test(zh[key]), `zh.${key} should be Chinese: ${zh[key]}`)
  }
})

test('every statically referenced translation key exists in both dictionaries', () => {
  const { state } = applyPlugin()
  const { zh, en } = state.locales[0].dictionaries

  const keys = new Set()
  for (const match of source.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) keys.add(match[1])
  assert.ok(keys.size >= 70, `expected many static keys, found ${keys.size}`)
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
  }
})

test('page text is confined to the dictionaries', () => {
  const start = source.indexOf('const DICTIONARIES = {')
  const end = source.indexOf('const STYLES =')
  assert.ok(start >= 0 && end > start, 'dictionary block boundaries must be discoverable')
  const outside = `${source.slice(0, start)}\n${source.slice(end)}`
  const matches = outside.split('\n').filter((line) => CJK_PATTERN.test(line))
  assert.deepEqual(matches, [], `Chinese text outside the dictionaries: ${matches.join(' | ')}`)
})

test('request plumbing and the frozen route surface are wired', () => {
  for (const required of [
    '/expert-council/api/state',
    '/expert-council/api/consult',
    '/expert-council/api/action',
    "HEADER_NAME = 'x-expert-council'",
    'REFRESH_MS = 3000',
    "inject('sidebar.panellist'",
    "inject('main'",
    'order: 31',
    'visibilitychange',
    'prefers-reduced-motion',
    "startSessionWithBrief(",
    'sessions.create',
    "whenDraftExists: 'append'",
    'openSession',
    "'queue'",
    "action: 'convene'",
    "action: 'archive'",
    'briefConsultId',
    'protocol.limits.questionMin',
    'apiPost',
  ]) {
    assert.ok(source.includes(required), `client.js should contain ${required}`)
  }

  // Same-origin loopback only: no absolute fetch URLs anywhere.
  assert.ok(!/fetch\(\s*['"`]https?:/i.test(source), 'no absolute fetch URL')
  assert.ok(!source.includes('fetch("http'), 'no absolute fetch URL')
  assert.ok(!source.includes("fetch('http"), 'no absolute fetch URL')
})

test('convene posts to the action route and starts a session with the brief', () => {
  // The convene flow must POST {action:'convene'} and then hand the brief to
  // startSessionWithBrief, appending the consult id line.
  assert.ok(source.includes("action: 'convene'"))
  assert.ok(source.includes('startSessionWithBrief(ctx,'))
  assert.ok(source.includes("t('briefConsultId')"))
  assert.ok(source.includes('consultId'))
  assert.ok(source.includes('refreshAll()'))
})

test('V0.2 customisation surface is wired end to end', () => {
  const { state } = applyPlugin()
  const { zh, en } = state.locales[0].dictionaries

  // Mutations POST the frozen actions; reset must send the explicit confirm.
  for (const required of [
    "action: 'save-team'",
    "action: 'save-expert'",
    "action: 'delete'",
    "action: 'reset-custom'",
    'confirm: true',
    'TeamEditor',
    'ExpertEditor',
    'ExpertsView',
    'MembersPicker',
    'ConfirmRow',
    'EntityBadges',
    'ConsentNotice',
    'hasCustomization',
    'backTargetOf',
  ]) {
    assert.ok(source.includes(required), `client.js should contain ${required}`)
  }

  // Custom / preset / incomplete flags drive the badges and the convene gate.
  for (const required of ['entity.custom === true', 'entity.preset === true', 'incomplete === true', 'team.preset === true']) {
    assert.ok(source.includes(required), `client.js should contain ${required}`)
  }

  // Consent banner reads the Host policy and boundary text.
  assert.ok(source.includes('policy.requireExplicitConsent'))
  assert.ok(source.includes('policy.boundary'))

  // Representative copy, both languages.
  assert.equal(zh.badgeCustom, '自定义')
  assert.equal(en.badgeCustom, 'Custom')
  assert.equal(zh.badgeOverridden, '覆盖内置')
  assert.equal(en.badgeOverridden, 'Overridden')
  assert.equal(zh.badgePreset, '内置')
  assert.equal(en.badgePreset, 'Built-in')
  assert.equal(zh.incompleteTeam, '团队不完整')
  assert.equal(en.incompleteTeam, 'Team incomplete')
  assert.equal(zh.newTeam, '新建团队')
  assert.equal(en.newTeam, 'New team')
  assert.ok(CJK_PATTERN.test(zh.consentNotice))
  assert.ok(en.consentNotice.includes('Agent Teams'))

  const keys = [
    'consentNotice',
    'consentNoticeOff',
    'newTeam',
    'resetCustom',
    'resetConfirm',
    'confirmReset',
    'cancel',
    'save',
    'saving',
    'working',
    'saveFailed',
    'deleteFailed',
    'resetFailed',
    'resetDone',
    'deletedDone',
    'hiddenDone',
    'teamSaved',
    'expertSaved',
    'editTeam',
    'editExpert',
    'newExpert',
    'remove',
    'badgeCustom',
    'badgeOverridden',
    'badgePreset',
    'incompleteTeam',
    'incompleteTeamHint',
    'confirmDelete',
    'deletePresetTeam',
    'deleteCustomTeam',
    'deletePresetExpert',
    'deleteCustomExpert',
    'groupLabel',
    'idLabel',
    'nameZh',
    'nameEn',
    'taglineLabel',
    'linesHint',
    'pairsLabel',
    'pairsHint',
    'budgetLeanLabel',
    'budgetStandardLabel',
    'budgetDeepLabel',
    'membersHint',
    'errIdInvalid',
    'errNameZh',
    'errMandate',
    'errLens',
    'errAsks',
    'errRedLines',
    'errMisses',
    'errMembers',
    'errLead',
    'errBudgetOrder',
    'errAgenda',
    'saveTeam',
    'saveExpert',
  ]
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
    assert.ok(zh[key].length > 0, `zh.${key} must not be empty`)
    assert.ok(en[key].length > 0, `en.${key} must not be empty`)
  }

  // Client-side light validation vocabulary exists for the editors.
  for (const required of ['errMembers', 'errLead', 'errBudgetOrder', 'errAgenda']) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, required))
    assert.ok(Object.prototype.hasOwnProperty.call(en, required))
  }
})

test('V0.3 plain-language customisation and change history are wired', () => {
  const { state } = applyPlugin()
  const { zh, en } = state.locales[0].dictionaries

  for (const required of [
    "action: 'nl-request'",
    'nlRequest',
    'NaturalLanguageRequest',
    'RecentAdjustments',
    'SectionHeader',
    "t('nlSessionNote')",
    'startSessionWithBrief(ctx,',
    'disabled: pending || empty',
    'event.shiftKey',
    'if (entries.length === 0) return null',
    'adjustmentHistory',
    'historyActionLabel',
    'expert-create',
    'expert-override',
    'expert-delete',
    'expert-hide',
    'team-create',
    'team-override',
    'team-delete',
    'team-hide',
  ]) {
    assert.ok(source.includes(required), `client.js should contain ${required}`)
  }

  // Every customisation action has a label in both languages.
  const actionKeys = [
    'actionExpertCreate',
    'actionExpertOverride',
    'actionExpertDelete',
    'actionExpertHide',
    'actionTeamCreate',
    'actionTeamOverride',
    'actionTeamDelete',
    'actionTeamHide',
    'actionReset',
  ]
  for (const key of actionKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
    assert.ok(zh[key].length > 0)
    assert.ok(en[key].length > 0)
  }
  assert.equal(zh.actionExpertCreate, '新增专家')
  assert.equal(en.actionExpertCreate, 'New expert')
  assert.equal(zh.actionTeamHide, '隐藏团队')
  assert.equal(en.actionTeamHide, 'Hide team')
  assert.equal(zh.actionReset, '恢复出厂')
  assert.equal(en.actionReset, 'Factory reset')

  assert.equal(zh.nlTitle, '用一句话调整')
  assert.equal(en.nlTitle, 'Adjust in one sentence')
  assert.equal(zh.nlSubmit, '交给专家团助手')
  assert.equal(en.nlSubmit, 'Hand to the council assistant')
  assert.equal(zh.actorAgent, '助手')
  assert.equal(en.actorAgent, 'Assistant')
  assert.equal(zh.historyTitle, '最近调整')
  assert.equal(en.historyTitle, 'Recent changes')
  assert.equal(zh.overviewTitle, '概览')
  assert.equal(en.overviewTitle, 'Overview')
  assert.ok(CJK_PATTERN.test(zh.nlDesc))
  assert.ok(en.nlDesc.includes('assistant'))

  const keys = [
    'nlTitle',
    'nlDesc',
    'nlPlaceholder',
    'nlExamples',
    'nlExample1',
    'nlExample2',
    'nlExample3',
    'nlSubmit',
    'nlSubmitting',
    'nlSuccess',
    'nlEmpty',
    'nlHint',
    'nlSessionNote',
    'historyTitle',
    'historyDesc',
    'historyRequest',
    'actorUser',
    'actorAgent',
    'overviewTitle',
    'overviewDesc',
    'teamsDesc',
    'consultsDesc',
  ]
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
    assert.ok(zh[key].length > 0, `zh.${key} must not be empty`)
    assert.ok(en[key].length > 0, `en.${key} must not be empty`)
  }

  // The request input is keyboard-submittable and the empty-input guard disables it.
  assert.ok(source.includes("placeholder: t('nlPlaceholder')"))
  assert.ok(source.includes("t('nlHint')"))
  assert.ok(source.includes('onSubmit: nlRequest'))
})


