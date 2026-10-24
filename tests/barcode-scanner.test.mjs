import assert from "node:assert/strict"
import test from "node:test"
import { cameraErrorMessage, createBarcodeScanner, getBarcodeCrop, scanBarcodeImage } from "../src/lib/barcode-scanner.mjs"

test("live barcode crop matches centered cover previews in landscape and portrait video", () => {
  const stage = { left: 0, top: 0, width: 200, height: 200 }
  const guide = { left: 50, top: 75, width: 100, height: 50 }
  assert.deepEqual(getBarcodeCrop(1000, 500, stage, guide), { x: 375, y: 187, width: 250, height: 125 })
  assert.deepEqual(getBarcodeCrop(500, 1000, stage, guide), { x: 125, y: 437, width: 250, height: 125 })
  assert.deepEqual(getBarcodeCrop(1000, 500, { ...stage, left: 20, top: 40 }, { ...guide, left: 70, top: 115 }),
    getBarcodeCrop(1000, 500, stage, guide))
  assert.equal(getBarcodeCrop(0, 500, stage, guide), null)
  assert.equal(getBarcodeCrop(1000, 500, stage, { ...guide, left: 9999 }), null)
})

test("camera failures distinguish permissions, missing hardware and occupied cameras", () => {
  assert.match(cameraErrorMessage({ name: "NotAllowedError" }), /权限未开启/)
  assert.match(cameraErrorMessage({ name: "SecurityError" }), /权限未开启/)
  assert.match(cameraErrorMessage({ name: "NotFoundError" }), /没有找到可用相机/)
  assert.match(cameraErrorMessage({ name: "NotReadableError" }), /其他应用占用/)
  assert.match(cameraErrorMessage(new Error("unknown")), /启动失败/)
})

test("mobile fallback decodes an actual EAN barcode without BarcodeDetector", async () => {
  const previous = globalThis.BarcodeDetector
  delete globalThis.BarcodeDetector
  try {
    const bars = "101" + "0001011" + "0100111" + "0011001" + "0010011" + "0100001" + "0011101" + "01010" + "1001110" + "1010000" + "1000100" + "1001000" + "1110100" + "1011100" + "101"
    const data = new Uint8ClampedArray(480 * 160 * 4).fill(255)
    for (let row = 0; row < 160; row++) {
      for (let column = 0; column < 480; column++) {
        if (row > 20 && row < 140 && bars[Math.floor((column - 50) / 4)] === "1") data.fill(0, (row * 480 + column) * 4, (row * 480 + column) * 4 + 3)
      }
    }
    const canvas = { width: 480, height: 160, getContext: () => ({ getImageData: () => ({ data }) }) }
    const scanner = await createBarcodeScanner()
    assert.equal((await scanner.detect(canvas))[0].rawValue, "4901234567894")
    data.fill(255)
    assert.deepEqual(await scanner.detect(canvas), [])
  } finally {
    if (previous) globalThis.BarcodeDetector = previous
  }
})

test("image scanning bounds resolution, retries rotation, rejects ambiguity and releases images", async () => {
  const previous = { Image: globalThis.Image, document: globalThis.document, BarcodeDetector: globalThis.BarcodeDetector }
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let revoked = 0
  let detects = 0
  let mode = "rotate"
  const canvas = { getContext: () => ({ translate() {}, rotate() {}, drawImage() {} }) }
  globalThis.Image = class {
    naturalWidth = 4000
    naturalHeight = 2000
    async decode() { if (mode === "invalid") throw new Error("invalid") }
  }
  globalThis.document = { createElement: () => canvas }
  globalThis.BarcodeDetector = class {
    static async getSupportedFormats() { return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] }
    async detect(image) {
      detects++
      assert.equal(Math.max(image.width, image.height), 2048)
      const result = { rawValue: "4901234567894", boundingBox: { x: 10, y: 20, width: 200, height: 30 } }
      if (mode === "multiple") return [result, { ...result, rawValue: "4987188161027" }]
      if (mode === "blank" || detects === 1) return []
      assert.equal(image.height, 2048)
      return [result]
    }
  }
  URL.createObjectURL = () => "blob:test"
  URL.revokeObjectURL = () => { revoked++ }
  try {
    const result = await scanBarcodeImage({ size: 100 })
    assert.equal(result.rawValue, "4901234567894")
    assert.equal(result.snapshot, canvas)
    assert.equal(detects, 2)
    assert.equal(revoked, 1)
    mode = "multiple"
    await assert.rejects(scanBarcodeImage({ size: 100 }), /多个条码/)
    mode = "blank"
    await assert.rejects(scanBarcodeImage({ size: 100 }), /没有识别到/)
    mode = "invalid"
    await assert.rejects(scanBarcodeImage({ size: 100 }), /无法读取/)
    await assert.rejects(scanBarcodeImage({ size: 21 * 1024 * 1024 }), /20 MB/)
    assert.equal(revoked, 4)
  } finally {
    Object.assign(globalThis, previous)
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})
