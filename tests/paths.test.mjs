import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { appPath } from "../src/lib/paths.mjs"

test("prefixes internal routes for GitHub project pages", () => {
  assert.equal(appPath("/scan/", "/aaprice/"), "/aaprice/scan/")
  assert.equal(appPath("/", "/"), "/")
})

test("builds the custom domain from the site root", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")
  assert.match(workflow, /ASTRO_BASE_PATH: \/$/m)
  assert.match(workflow, /PUBLIC_SITE_URL: https:\/\/prices\.stbf\.online/)
  assert.match(workflow, /node scripts\/verify-production-site\.mjs https:\/\/prices\.stbf\.online\//)
})
