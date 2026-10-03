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
    savedScansRef: { current: new Set() }, setSubmitting() {}, setStatus() {},
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
