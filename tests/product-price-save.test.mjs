import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Execute the actual component handler with isolated API/state bindings, not a copy of its logic.
const source = readFileSync(new URL("../src/components/ProductApp.jsx", import.meta.url), "utf8")
const handler = source.slice(source.indexOf("  const savePrice = async"), source.indexOf("\n  if (loading) return"))
function setup(overrides = {}) {
  const calls = { private: 0, public: 0, telemetry: 0, status: "", form: null }
  const context = {
    priceSaveBusy: { current: false }, savedPersonalEntries: { current: new Set() },
    form: { store_id: "store", price_yen: "980", note: "", evidence_url: "", share_to_public: true },
    session: { user: { id: "test-user" } }, productId: "product", taskFlow: true,
    setSavingPrice() {}, setStatus(value) { calls.status = value }, setForm(value) { calls.form = value }, setLogs() {},
    async savePersonalLog() { calls.private++ }, async submitStorePrice() { calls.public++ },
    async recordTelemetryEvent() { calls.telemetry++ }, async fetchPersonalLogs() { return [] },
    friendlyApiError(error) { return error.message }, ...overrides,
  }
  const save = new Function(...Object.keys(context), `${handler}\nreturn savePrice`)(...Object.values(context))
  return { calls, context, save: () => save({ preventDefault() {} }) }
}

test("unchecked task submission reports only private success", async () => {
  const state = setup()
  state.context.form.share_to_public = false
  await state.save()
  assert.equal(state.calls.status, "个人价格记录已保存。")
  assert.equal(state.calls.private, 1)
  assert.equal(state.calls.public, 0)
  assert.equal(state.calls.telemetry, 0)
})

test("public failure preserves form and retries without duplicating confirmed private save", async () => {
  let attempts = 0
  const state = setup({ async submitStorePrice() { if (++attempts === 1) throw new Error("offline") } })
  await state.save()
  assert.match(state.calls.status, /个人记录已保存，但公共提交未确认成功/)
  assert.equal(state.calls.form, null)
  assert.equal(state.calls.telemetry, 0)
  await state.save()
  assert.equal(state.calls.private, 1)
  assert.equal(attempts, 2)
  assert.equal(state.calls.telemetry, 1)
  assert.equal(state.calls.status, "补价任务已提交审核，审核通过后发放积分。")
})

test("list refresh failure cannot turn a successful submission into a save error", async () => {
  const state = setup({ async fetchPersonalLogs() { throw new Error("offline") } })
  await state.save()
  assert.match(state.calls.status, /^补价任务已提交审核.*记录列表暂未刷新/)
  assert.equal(state.calls.public, 1)
  assert.equal(state.context.priceSaveBusy.current, false)
})

test("private save failure prevents public submission and concurrent submits are ignored", async () => {
  const state = setup({ async savePersonalLog() { throw new Error("private failed") } })
  await Promise.all([state.save(), state.save()])
  assert.equal(state.calls.status, "private failed")
  assert.equal(state.calls.public, 0)
  assert.equal(state.context.savedPersonalEntries.current.size, 0)
  assert.equal(state.context.priceSaveBusy.current, false)
})
