import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { appPath, authRedirectUrl, safeReturnPath } from "../src/lib/paths.mjs"

test("prefixes internal routes for GitHub project pages", () => {
  assert.equal(appPath("/scan/", "/aaprice/"), "/aaprice/scan/")
  assert.equal(appPath("/", "/"), "/")
})

test("authentication return paths stay internal, including malformed and disguised URLs", () => {
  for (const value of [undefined, null, {}, "", "https://evil.example/", "//evil.example/", "/\\evil.example/", "/\n/evil.example/", "//[", "javascript:alert(1)"]) {
    assert.equal(safeReturnPath(value), "", String(value))
  }
  assert.equal(safeReturnPath("/product/?id=123#record-price"), "/product/?id=123#record-price")
  assert.equal(safeReturnPath("/?q=%E5%8C%96%E7%B2%A7%E6%B0%B4"), "/?q=%E5%8C%96%E7%B2%A7%E6%B0%B4")
})

test("email callbacks preserve a safe destination and password recovery mode", () => {
  const signup = new URL(authRedirectUrl("https://prices.stbf.online", "/product/?id=123"))
  assert.equal(signup.origin + signup.pathname, "https://prices.stbf.online/login/")
  assert.equal(signup.searchParams.get("redirect"), "/product/?id=123")
  const reset = new URL(authRedirectUrl("https://prices.stbf.online", "/me/", "reset"))
  assert.equal(reset.searchParams.get("mode"), "reset")
  assert.equal(reset.searchParams.get("redirect"), "/me/")
  assert.equal(authRedirectUrl("https://prices.stbf.online", "//evil.example/"), "https://prices.stbf.online/login/")
})

test("builds the custom domain from the site root", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")
  assert.match(workflow, /ASTRO_BASE_PATH: \/$/m)
  assert.match(workflow, /PUBLIC_SITE_URL: https:\/\/prices\.stbf\.online/)
  assert.match(workflow, /PUBLIC_SUPABASE_URL: https:\/\/tplkpguxlvrhxassyjfm\.supabase\.co/)
  assert.match(workflow, /node scripts\/verify-production-site\.mjs https:\/\/prices\.stbf\.online\//)
})
