import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CONFIG,
  KIND_LABELS,
  buildScript,
  inject,
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
  assert.match(script, /skip: dsh foreground title=/)
  assert.match(script, /DispatcherTimer/)
  assert.match(script, /auto-close: dsh foreground title=/)
  assert.match(script, /FindByTitle\('— DeepSeek Harness'\)/)
  assert.match(script, /Activate\(\$h\)/)
  assert.match(script, /click: close button/)
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
})

test('sub-agents stay quiet when requested', () => {
  assert.equal(shouldNotify({ session: { header: { origin: 'subagent' } } }, true), false)
  assert.equal(shouldNotify({ session: { header: { delegationDepth: 2 } } }, true), false)
  assert.equal(shouldNotify({ session: { header: {} } }, true), true)
  assert.equal(shouldNotify({ session: { header: { origin: 'subagent' } } }, false), true)
})
