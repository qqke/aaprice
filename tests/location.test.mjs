import assert from "node:assert/strict"
import test from "node:test"
import { readLocation, requestLocation } from "../src/lib/location.mjs"

test("location is shared briefly across pages and geolocation failures stay actionable", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")
  let saved
  let fail
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => saved, setItem: (_, value) => { saved = value } } })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition(success, failure, options) {
    assert.equal(options.enableHighAccuracy, true)
    if (fail) failure({ code: fail })
    else success({ coords: { latitude: 35.5, longitude: 139.6 } })
  } } } })
  try {
    assert.equal(readLocation(), null)
    assert.deepEqual(await requestLocation(), { lat: 35.5, lng: 139.6 })
    assert.deepEqual(readLocation(), { lat: 35.5, lng: 139.6 })
    saved = JSON.stringify({ lat: 35.5, lng: 139.6, savedAt: Date.now() - 300001 })
    assert.equal(readLocation(), null)
    for (const [code, message] of [[1, /权限被拒绝/], [2, /定位服务/], [3, /超时/]]) {
      fail = code
      await assert.rejects(requestLocation(), message)
    }
    navigator.geolocation = null
    await assert.rejects(requestLocation(), /不支持定位/)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
    else delete globalThis.navigator
    if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage)
    else delete globalThis.sessionStorage
  }
})
