import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { parseShelfPrice } from "../src/lib/scan-price.mjs"

test("shelf price prefers explicit tax inclusive amount, never barcode fragments", () => {
  assert.deepEqual(parseShelfPrice("1,490 円\n(税込 1,639 円)\n5841 4573555778839", 90), { price: "1639", automatic: true })
  assert.deepEqual(parseShelfPrice("2,490 円\n(税込 2,739 円)", 50), { price: "2739", automatic: false })
  assert.deepEqual(parseShelfPrice("税込 ￥１，６３９", 90), { price: "1639", automatic: true })
  assert.deepEqual(parseShelfPrice("1490 円 1639 円", 90), { price: "1639", automatic: false })
  assert.deepEqual(parseShelfPrice("税込 1639 円\n税込 2739 円", 90), { price: "", automatic: false })
  assert.deepEqual(parseShelfPrice("4573555778839 5841", 90), { price: "", automatic: false })
  assert.deepEqual(parseShelfPrice("¥4573555778839", 90), { price: "", automatic: false })
  assert.deepEqual(parseShelfPrice('"1.490 = 3\n(= 1639 =~', 53), { price: "1639", automatic: false })
  assert.deepEqual(parseShelfPrice("¥1490", 90), { price: "1490", automatic: false })
})

const source = readFileSync(new URL("../src/components/CompareApp.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n")
const handler = source.slice(source.indexOf("  const saveScan = async"), source.indexOf("\n  useEffect(() => {\n    const cleanup"))
test("automatic mode saves only a certain price with a selected store; manual mode waits", async () => {
  const lookupSource = source.slice(source.indexOf("  const lookup = async"), source.indexOf("\n  const submitMissing"))
  for (const [mode, automatic, hasStore, expected] of [["auto", true, true, 1], ["auto", false, true, 0], ["auto", true, false, 0], ["manual", true, true, 0]]) {
    let saves = 0
    let pending = null
    const context = {
      cleanJanCode: (value) => value, scanBusyRef: { current: false }, saveBusyRef: { current: false },
      scanEpochRef: { current: 0 }, pendingProductRef: { current: null }, lookupRef: { current: null },
      setLookingUp() {}, setManualCode() {}, setRecognizedPrice() {}, setDraft() {}, setStatus() {},
      setPendingProduct(value) { pending = value },
      async readPrice() { return { price: "1639", automatic } },
      streamRef: { current: {} }, openRef: { current: true }, supabaseConfigured: true,
      async fetchProductByBarcode() { return { id: "product", name: "Test" } },
      stopCamera() {}, mapProductRow: (row) => row, enableOcr: true, session: {}, saveMode: mode,
      scanStore: hasStore ? { id: "store" } : null,
      async saveScan(product, price) { assert.equal(price, "1639"); saves++ },
      friendlyApiError: (error) => { throw error }, requestAnimationFrame() {}, open: true,
    }
    await new Function(...Object.keys(context), `${lookupSource}\nreturn lookup`)(...Object.values(context))("4901234567894", { width: 100 })
    assert.equal(saves, expected)
    assert.equal(pending.id, "product")
  }
})
test("scan saving requires store, prevents duplicate writes, preserves failed result for retry", async () => {
  let attempts = 0
  let cleared = 0
  const context = {
    session: { user: { id: "user" } }, saveBusyRef: { current: false }, scanStore: null,
    scanEpochRef: { current: 0 }, openRef: { current: true }, pendingProductRef: { current: {} },
    savedScansRef: { current: new Set() }, setSubmitting() {}, setStatus() {}, setRecognizedPrice() {},
    async savePersonalLog() { if (++attempts === 1) throw new Error("offline") },
    setPendingProduct() { cleared++ }, friendlyApiError: (error) => error.message,
  }
  const save = () => new Function(...Object.keys(context), `${handler}\nreturn saveScan`)(...Object.values(context))({ id: "product", name: "Product" }, "1639")
  await save()
  assert.equal(attempts, 0)
  context.scanStore = { id: "store" }
  await save()
  assert.equal(cleared, 0)
  await save()
  await save()
  assert.equal(attempts, 2)
  assert.equal(cleared, 1)
})

test("catalog lookup starts before OCR finishes and keeps the camera for confirmation", async () => {
  let finishOcr
  let queried = false
  let stops = 0
  let pending = null
  const context = {
    cleanJanCode: (value) => value, scanBusyRef: { current: false }, saveBusyRef: { current: false },
    scanEpochRef: { current: 0 }, pendingProductRef: { current: null }, lookupRef: { current: null },
    setLookingUp() {}, setManualCode() {}, setRecognizedPrice() {}, setDraft() {}, setStatus() {},
    setPendingProduct(value) { pending = value },
    readPrice: () => new Promise((resolve) => { finishOcr = resolve }),
    streamRef: { current: {} }, openRef: { current: true }, supabaseConfigured: true,
    async fetchProductByBarcode() { queried = true; return { id: "product" } },
    stopCamera() { stops++ }, mapProductRow: (row) => row, enableOcr: true, session: {}, saveMode: "manual",
    scanStore: { id: "store" }, friendlyApiError: (error) => { throw error }, requestAnimationFrame() {}, open: true,
  }
  const lookupSource = source.slice(source.indexOf("  const lookup = async"), source.indexOf("\n  const submitMissing"))
  const lookup = new Function(...Object.keys(context), `${lookupSource}\nreturn lookup`)(...Object.values(context))
  const running = lookup("4901234567894", { width: 100 }, {})
  await Promise.resolve()
  const startedConcurrently = queried
  finishOcr({ price: "1639", automatic: false })
  await running
  assert.equal(startedConcurrently, true)
  assert.equal(stops, 0)
  assert.equal(pending.id, "product")

  pending = null
  context.pendingProductRef.current = null
  const canceled = lookup("4901234567894", { width: 100 }, {})
  context.scanEpochRef.current++
  finishOcr({ price: "1639", automatic: true })
  await canceled
  assert.equal(pending, null)
})

test("camera loop pauses for confirmation, waits for barcode departure and uses the latest lookup", async () => {
  let frame
  let detections = 0
  let lookups = 0
  let warmed = 0
  let values = ["4901234567894"]
  const stream = {}
  const snapshot = { getContext: () => ({ drawImage() {} }) }
  class Detector {
    static async getSupportedFormats() { return ["ean_13", "qr_code"] }
    constructor({ formats }) { assert.deepEqual(formats, ["ean_13"]) }
    async detect(image) {
      assert.equal(image, snapshot)
      detections++
      return values.map((rawValue) => ({ rawValue, boundingBox: { width: 100 } }))
    }
  }
  const context = {
    streamRef: { current: null }, lookingUp: false, submitting: false,
    scanEpochRef: { current: 0 }, pendingProductRef: { current: null },
    setPendingProduct() {}, setRecognizedPrice() {}, setStatus() {}, setScanning() {},
    navigator: { mediaDevices: { async getUserMedia() { return stream } } },
    openRef: { current: true }, videoRef: { current: { async play() {}, videoWidth: 1920, videoHeight: 1080 } },
    window: { BarcodeDetector: Detector }, BarcodeDetector: Detector,
    enableOcr: true, prepareOcr() { warmed++; return Promise.resolve({}) },
    document: { createElement: () => snapshot },
    scanBusyRef: { current: false }, saveBusyRef: { current: false }, frameRef: { current: null },
    requestAnimationFrame(callback) { frame = callback; return 1 },
    lookupRef: { current: null }, stopCamera() { throw new Error("camera unexpectedly stopped") },
  }
  context.lookupRef.current = async (barcode, bounds, image) => {
    assert.equal(image, snapshot)
    assert.equal(barcode, values[0])
    lookups++
    context.pendingProductRef.current = { id: barcode }
  }
  const startSource = source.slice(source.indexOf("  const startCamera = async"), source.indexOf("\n  useEffect(() => {\n    if (!open) return undefined"))
  const start = new Function(...Object.keys(context), `${startSource}\nreturn startCamera`)(...Object.values(context))
  await start()
  assert.equal(warmed, 1)
  await frame(250)
  assert.equal(lookups, 1)
  await frame(500)
  assert.equal(detections, 1)
  context.pendingProductRef.current = null
  await frame(750)
  assert.equal(lookups, 1)
  values = []
  await frame(1000)
  values = ["4901234567894"]
  const previousLookup = context.lookupRef.current
  context.lookupRef.current = async (...args) => { await previousLookup(...args); lookups += 10 }
  await frame(1250)
  assert.equal(lookups, 12)
  assert.equal(context.streamRef.current, stream)
  context.openRef.current = false
  await frame(1500)
  assert.equal(detections, 4)
})

test("OCR reads the captured frame with a bounded crop and leaves result updates to lookup", async () => {
  let drawn
  let preparations = 0
  const canvas = { getContext: () => ({ drawImage(...args) { drawn = args } }) }
  const snapshot = { width: 4000, height: 3000 }
  const context = {
    enableOcr: true, videoRef: { current: {} }, canvasRef: { current: canvas }, streamRef: { current: {} },
    setStatus() {}, parseShelfPrice,
    async prepareOcr() { preparations++; return { async recognize(image) { assert.equal(image, canvas); return { data: { text: "税込 1639 円", confidence: 90 } } } } },
  }
  const readSource = source.slice(source.indexOf("  const readPrice = async"), source.indexOf("\n  useEffect(() => {\n    if (!open || !session)"))
  const read = new Function(...Object.keys(context), `${readSource}\nreturn readPrice`)(...Object.values(context))
  assert.deepEqual(await read({ x: 500, y: 2000, width: 1500, height: 100 }, snapshot), { price: "1639", automatic: true })
  assert.equal(drawn[0], snapshot)
  assert.equal(Math.max(canvas.width, canvas.height), 1200)
  assert.equal(preparations, 1)
})
