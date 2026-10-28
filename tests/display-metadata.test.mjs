import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))

test('package manifest is installable as a DSH bundle', () => {
  const pkg = readJson('package.json')
  assert.equal(pkg.name, 'dsh-popup-cards')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, './lib/index.mjs')
  assert.equal(pkg.exports['.'], './lib/index.mjs')
  assert.equal(pkg.license, 'MIT')
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  assert.ok(pkg.files.includes('lib'))
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.match(pkg.engines.dsh, />=/)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.repository.url.includes('dsh-popup-cards'))
})

test('bundle patch loads the plugin by name', () => {
  const yaml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(yaml, /^-\s+insert:/m)
  assert.match(yaml, /id:\s*popup-notify/)
  assert.match(yaml, /name:\s*'dsh-popup-cards'/)
})

test('binary and metadata files listed in "files" exist', () => {
  const pkg = readJson('package.json')
  for (const entry of pkg.files) {
    if (entry.includes('*')) continue
    assert.ok(existsSync(join(root, entry)), `${entry} is listed in package.json but missing`)
  }
  assert.ok(existsSync(join(root, pkg.dsh.bundle.patch)))
})

test('locales are bilingual and complete', () => {
  const zh = readJson('locale/zh.json')
  const en = readJson('locale/en.json')
  for (const locale of [zh, en]) {
    assert.equal(typeof locale.meta.title, 'string')
    assert.ok(locale.meta.title.length > 0)
    assert.equal(typeof locale.meta.description, 'string')
    assert.ok(locale.meta.description.length > 20)
  }
  assert.deepEqual(Object.keys(zh.meta).sort(), Object.keys(en.meta).sort())
  assert.notEqual(zh.meta.title, en.meta.title)
})

test('screenshots manifest stays inside the repository', () => {
  const shots = readJson('screenshots.json')
  assert.ok(Array.isArray(shots))
  assert.ok(shots.length >= 1 && shots.length <= 8)
  for (const shot of shots) {
    assert.equal(typeof shot, 'string')
    assert.ok(!shot.startsWith('/'), 'no absolute paths')
    assert.ok(!shot.includes('..'), 'no parent-directory escapes')
    assert.match(shot, /\.(png|jpe?g|webp)$/i)
  }
})

test('license keeps upstream attribution', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  assert.match(license, /^MIT License/)
  assert.match(license, /yiumanlenong/)
  assert.match(license, /Permission is hereby granted/)
})

test('both READMEs document installation and upstream attribution', () => {
  const en = readFileSync(join(root, 'README.md'), 'utf8')
  const zh = readFileSync(join(root, 'README.zh-CN.md'), 'utf8')
  for (const doc of [en, zh]) {
    assert.match(doc, /dsh plugin --profile desktop add/)
    assert.match(doc, /Windows/)
    assert.match(doc, /yiumanlenong/)
  }
  assert.match(en, /README\.zh-CN\.md/)
  assert.match(zh, /README\.md/)
})
