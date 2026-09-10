import assert from "node:assert/strict"
import test from "node:test"
import { verifyModuleGraph } from "../scripts/verify-module-graph.mjs"

const endpoint = "https://project.supabase.co"
const entry = "https://example.com/_astro/App.js"
test("finds API configuration in renamed nested chunks, visits cycles once and checks all dependencies", async () => {
  const sources = {
    "App.js": 'import{x}from"./badge.hash.js";import"./other.js";',
    "badge.hash.js": 'export{x}from"./shared.js";',
    "shared.js": `import"./App.js";const url="${endpoint}";`,
    "other.js": "export const x=1;",
  }
  const calls = []
  const request = async (url) => { calls.push(url); return { ok: true, text: sources[url.split("/").pop()] } }
  assert.equal(await verifyModuleGraph(entry, endpoint, request), 4)
  assert.equal(new Set(calls).size, calls.length)
})
test("inlined configuration works but missing configuration and broken chunks still fail", async () => {
  assert.equal(await verifyModuleGraph(entry, endpoint, async () => ({ ok: true, text: `const url="${endpoint}"` })), 1)
  await assert.rejects(verifyModuleGraph(entry, endpoint, async () => ({ ok: true, text: "export const x=1" })), /expected Supabase URL/)
  await assert.rejects(verifyModuleGraph(entry, endpoint, async (url) => url === entry ? { ok: true, text: `import"./missing.js";const url="${endpoint}"` } : { ok: false, status: 404 }), /404/)
  await assert.rejects(verifyModuleGraph(entry, endpoint, async () => ({ ok: true, text: "<!doctype html>" })), /HTML/)
})
