import assert from "node:assert/strict"
import test from "node:test"

import { appPath } from "../src/lib/paths.mjs"

test("prefixes internal routes for GitHub project pages", () => {
  assert.equal(appPath("/scan/", "/aaprice/"), "/aaprice/scan/")
  assert.equal(appPath("/", "/"), "/")
})
