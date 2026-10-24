import assert from "node:assert/strict"
import test from "node:test"
import { observeCommercialExposure } from "../src/lib/commercial-exposure.mjs"

test("commercial exposure requires a visible button and active tab, records once, and cleans up", () => {
  const oldObserver = globalThis.IntersectionObserver, oldDocument = globalThis.document
  let notify, visibility, observed = 0, disconnected = 0, count = 0
  globalThis.document = {
    visibilityState: "visible",
    addEventListener(name, fn) { assert.equal(name, "visibilitychange"); visibility = fn },
    removeEventListener(name, fn) { assert.equal(fn, visibility); visibility = null },
  }
  globalThis.IntersectionObserver = class {
    constructor(fn, options) { notify = fn; assert.equal(options.threshold, 0.5) }
    observe() { observed++ }
    unobserve() {}
    disconnect() { disconnected++ }
  }
  try {
    const stop = observeCommercialExposure({}, () => count++)
    assert.equal(count, 0)
    notify([{ isIntersecting: false, intersectionRatio: 0.8 }])
    notify([{ isIntersecting: true, intersectionRatio: 0.49 }])
    document.visibilityState = "hidden"
    notify([{ isIntersecting: true, intersectionRatio: 1 }])
    assert.equal(count, 0)
    document.visibilityState = "visible"
    visibility()
    assert.equal(observed, 2)
    notify([{ isIntersecting: true, intersectionRatio: 0.5 }])
    notify([{ isIntersecting: true, intersectionRatio: 1 }])
    assert.equal(count, 1)
    assert.equal(disconnected, 1)
    stop()
    assert.equal(visibility, null)
    notify([{ isIntersecting: true, intersectionRatio: 1 }])
    assert.equal(count, 1)
    globalThis.IntersectionObserver = undefined
    observeCommercialExposure({}, () => count++)()
    assert.equal(count, 1)
  } finally {
    globalThis.IntersectionObserver = oldObserver
    globalThis.document = oldDocument
  }
})
