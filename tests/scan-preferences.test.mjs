import assert from 'node:assert/strict'
import test from 'node:test'
import { readScanPriceFirst, saveScanPriceFirst } from '../src/lib/scan-preferences.mjs'

test('scan price preference defaults off, persists toggles and tolerates blocked storage', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } })
    assert.equal(readScanPriceFirst(), false)
    saveScanPriceFirst(true)
    assert.equal(readScanPriceFirst(), true)
    saveScanPriceFirst(false)
    assert.equal(readScanPriceFirst(), false)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    assert.equal(readScanPriceFirst(), false)
    assert.doesNotThrow(() => saveScanPriceFirst(true))
    assert.equal(readScanPriceFirst(), true)
    saveScanPriceFirst(false)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
