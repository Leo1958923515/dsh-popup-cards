import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CONFIG,
  DSH_PROCESS,
  KIND_LABELS,
  apply,
  buildProbeScript,
  buildScript,
  clientProcessesOf,
  inject,
  isClientProcess,
  name,
  shouldNotify,
  taskNameOf,
} from '../lib/index.mjs'

test('identity exports', () => {
  assert.equal(name, 'dsh-popup-cards')
  assert.deepEqual(inject, [])
})

test('confirmation kinds are user facing', () => {
  assert.deepEqual(KIND_LABELS, {
    approval: '权限确认',
    question: '提问待答',
    planReview: '计划确认',
    complete: '任务完成',
    selfTest: '插件自检',
  })
})

test('defaults keep the card quiet and non-intrusive', () => {
  assert.equal(DEFAULT_CONFIG.sound, false)
  assert.equal(DEFAULT_CONFIG.durationMs, 0)
  assert.equal(DEFAULT_CONFIG.skipWhenDSHFocused, true)
  assert.equal(DEFAULT_CONFIG.activateDSHOnClick, true)
  assert.equal(DEFAULT_CONFIG.autoCloseOnDSHFocus, true)
  assert.equal(DEFAULT_CONFIG.hintText, '点击回到 DSH')
  assert.equal(DEFAULT_CONFIG.attributeByClient, true)
  assert.deepEqual(DEFAULT_CONFIG.clientProcesses, [])
})

test('buildScript emits one self-contained PowerShell script', () => {
  const script = buildScript('任务', KIND_LABELS.approval, DEFAULT_CONFIG)
  assert.match(script, /^\$ErrorActionPreference = "Stop"$/m)
  assert.match(script, /Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase/)
  assert.match(script, /ShowDialog\(\)/)
  assert.match(script, /卡片|ShowDialog/, 'script should construct a window')
})

test('card carries the DSH look and only the two facts plus hint', () => {
  const script = buildScript('重构登录模块', KIND_LABELS.question, DEFAULT_CONFIG)
  assert.match(script, /Background="#2C2C2E"/)
  assert.match(script, /CornerRadius="12"/)
  assert.match(script, /BorderBrush="#1FFFFFFF"/)
  assert.match(script, /x:Name="TaskText"/)
  assert.match(script, /x:Name="KindText"/)
  assert.match(script, /x:Name="HintText"/)
  assert.match(script, /x:Name="CloseButton"/)
  assert.match(script, /FindName\('TaskText'\)\.Text = '重构登录模块'/)
  assert.match(script, /FindName\('KindText'\)\.Text = '提问待答'/)
})

test('foreground gate, auto-close poll and click handler are emitted', () => {
  const script = buildScript('任务', KIND_LABELS.approval, DEFAULT_CONFIG)
  assert.match(script, /Add-Type -MemberDefinition[\s\S]*-Name DshPopupWin/)
  assert.match(script, /\[DshPopupNotify\.DshPopupWin\]::ForegroundTitle\(\)/)
  assert.match(script, /\[DshPopupNotify\.DshPopupWin\]::ForegroundProcessName\(\)/)
  assert.match(script, /skip: client foreground exe=/)
  assert.match(script, /DispatcherTimer/)
  assert.match(script, /auto-close: client foreground exe=/)
  assert.match(script, /FindByTitle\('— DeepSeek Harness'\)/)
  assert.match(script, /Activate\(\$h\)/)
  assert.match(script, /click: close button/)
})

test('client process list is normalised for attribution', () => {
  assert.deepEqual(clientProcessesOf('Obsidian.exe'), ['Obsidian.exe'])
  assert.deepEqual(clientProcessesOf([' Obsidian.exe ', 'obsidian.exe', '', 3]), ['Obsidian.exe'])
  assert.deepEqual(clientProcessesOf(undefined), [])
  assert.equal(isClientProcess('Obsidian.exe', ['obsidian.exe']), true)
  assert.equal(isClientProcess(DSH_PROCESS, []), true)
  assert.equal(isClientProcess('chrome.exe', ['Obsidian.exe']), false)
  assert.equal(isClientProcess('', ['Obsidian.exe']), false)
})

test('the card compares the foreground process, not just the title', () => {
  const script = buildScript('任务', KIND_LABELS.approval, {
    ...DEFAULT_CONFIG,
    clientProcesses: ['Obsidian.exe'],
    clientExe: 'Obsidian.exe',
  })
  assert.match(script, /\$clientExe = 'Obsidian\.exe'/)
  assert.match(script, /\$dshExe = 'DeepSeek Harness\.exe'/)
  assert.match(script, /if \(\$fgExe -eq \$dshExe/)
  assert.match(script, /-eq \$clientExe/)
  assert.match(script, /FindByProcessName\(\$clientExe\)/)

  const noClient = buildScript('任务', KIND_LABELS.approval, DEFAULT_CONFIG)
  assert.match(noClient, /\$clientExe = ''/)
  assert.match(noClient, /FindByTitle\('— DeepSeek Harness'\)/)
})

test('foreground probe script reads the process name', () => {
  const probe = buildProbeScript()
  assert.match(probe, /GetForegroundWindow/)
  assert.match(probe, /GetWindowThreadProcessId/)
  assert.match(probe, /Get-Process -Id \$procId/)
})

test('a card carries the client that started the session', { skip: process.platform === 'win32' ? false : 'Windows-only card spawn' }, () => {
  const handlers = {}
  const shown = []
  const ctx = {
    on: (event, handler) => {
      handlers[event] = handler
    },
    effect: (fn) => {
      fn()
    },
    logger: { warn() {} },
    get: () => undefined,
  }
  const child = { pid: 1, once() {} }
  apply(ctx, { ...DEFAULT_CONFIG, clientProcesses: ['Obsidian.exe'] }, {
    spawnDialog: (task, kind, config) => {
      shown.push({ task, kind, config })
      return child
    },
    foregroundProcessName: (callback) => callback('Obsidian.exe'),
  })
  const agent = { id: 'a1', session: { id: 's1', header: {} } }
  handlers['agent/status']({ agent, status: 'running' })
  handlers['approval/request']({ agent, toolName: 'pwsh' }, () => {})
  assert.equal(shown.length, 1)
  assert.equal(shown[0].config.clientExe, 'Obsidian.exe')
})

test('no attribution when the front app is not a client', { skip: process.platform === 'win32' ? false : 'Windows-only card spawn' }, () => {
  const handlers = {}
  const shown = []
  const ctx = {
    on: (event, handler) => {
      handlers[event] = handler
    },
    effect: (fn) => {
      fn()
    },
    logger: { warn() {} },
    get: () => undefined,
  }
  apply(ctx, { ...DEFAULT_CONFIG, clientProcesses: ['Obsidian.exe'] }, {
    spawnDialog: (task, kind, config) => {
      shown.push(config)
      return { pid: 1, once() {} }
    },
    foregroundProcessName: (callback) => callback('chrome.exe'),
  })
  const agent = { id: 'a1', session: { id: 's1', header: {} } }
  handlers['agent/status']({ agent, status: 'running' })
  handlers['approval/request']({ agent, toolName: 'pwsh' }, () => {})
  assert.equal(shown.length, 1)
  assert.equal(shown[0].clientExe, '')
})

test('sub-agents never overwrite the session attribution', () => {
  const handlers = {}
  const probes = []
  const ctx = {
    on: (event, handler) => {
      handlers[event] = handler
    },
    effect: (fn) => {
      fn()
    },
    logger: { warn() {} },
    get: () => undefined,
  }
  apply(ctx, { ...DEFAULT_CONFIG, clientProcesses: ['Obsidian.exe'] }, {
    spawnDialog: () => ({ pid: 1, once() {} }),
    foregroundProcessName: (callback) => {
      probes.push(1)
      callback('Obsidian.exe')
    },
  })
  const sub = { id: 'sub', session: { id: 's2', header: { delegationDepth: 1 } } }
  handlers['agent/status']({ agent: sub, status: 'running' })
  assert.equal(probes.length, 0)
})

test('switching behaviours off removes their machinery', () => {
  const script = buildScript('任务', KIND_LABELS.complete, {
    ...DEFAULT_CONFIG,
    skipWhenDSHFocused: false,
    activateDSHOnClick: false,
    autoCloseOnDSHFocus: false,
  })
  assert.doesNotMatch(script, /ForegroundTitle/)
  assert.doesNotMatch(script, /FindByTitle/)
  assert.doesNotMatch(script, /DispatcherTimer/)
  assert.match(script, /click: close button/, 'the × must work even with Win32 helpers off')
  assert.match(script, /TaskText/, 'the card still renders')
})

test('poll interval is clamped and duration is honoured', () => {
  const fast = buildScript('t', 'k', { ...DEFAULT_CONFIG, foregroundPollMs: 5 })
  assert.match(fast, /FromMilliseconds\(100\)/)
  const slow = buildScript('t', 'k', { ...DEFAULT_CONFIG, foregroundPollMs: 99999 })
  assert.match(slow, /FromMilliseconds\(2000\)/)
  const toast = buildScript('t', 'k', { ...DEFAULT_CONFIG, durationMs: 8000 })
  assert.match(toast, /\[TimeSpan\]::FromMilliseconds\(8000\)/)
  const sticky = buildScript('t', 'k', { ...DEFAULT_CONFIG, durationMs: 0 })
  assert.doesNotMatch(sticky, /\$timer\.Add_Tick/)
})

test('hint line can be hidden and text is quoted safely', () => {
  const hidden = buildScript('t', 'k', { ...DEFAULT_CONFIG, hintText: '' })
  assert.match(hidden, /\$hint\.Text = ''/)
  assert.match(hidden, /Visibility\]::Collapsed/)
  const quoted = buildScript("O'Brien", 'k', DEFAULT_CONFIG)
  assert.match(quoted, /FindName\('TaskText'\)\.Text = 'O''Brien'/)
})

test('task name resolution falls back in order', () => {
  const tilted = { get: () => ({ get: () => ({ title: '  修复 CI  ' }) }) }
  assert.equal(taskNameOf(tilted, {}), '修复 CI')

  const broken = { get: () => { throw new Error('no service') } }
  assert.equal(taskNameOf(broken, { header: { cwd: 'D:\\work\\proj' }, id: 'abcdef123456' }), 'proj')
  assert.equal(taskNameOf(broken, { id: 'abcdef123456' }), 'abcdef12')
  assert.equal(taskNameOf(broken, {}), 'DSH 任务')
  // POSIX 与 Windows 路径都要能取到末段；只剩盘符时退回会话 id。
  assert.equal(taskNameOf(broken, { header: { cwd: '/home/leo/proj' }, id: 'abcdef123456' }), 'proj')
  assert.equal(taskNameOf(broken, { header: { cwd: 'C:\\' }, id: 'abcdef123456' }), 'abcdef12')
})

test('sub-agents stay quiet when requested', () => {
  assert.equal(shouldNotify({ session: { header: { origin: 'subagent' } } }, true), false)
  assert.equal(shouldNotify({ session: { header: { delegationDepth: 2 } } }, true), false)
  assert.equal(shouldNotify({ session: { header: {} } }, true), true)
  assert.equal(shouldNotify({ session: { header: { origin: 'subagent' } } }, false), true)
})
