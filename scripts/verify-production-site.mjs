import https from "node:https"

const siteUrl = process.argv[2]

if (!siteUrl?.startsWith("https://")) {
  console.error("Usage: node scripts/verify-production-site.mjs https://example.com/")
  process.exit(1)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const request = (url, redirects = 0) => new Promise((resolve, reject) => {
  const call = https.get(url, { agent: false }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
      response.resume()
      resolve(request(new URL(response.headers.location, url), redirects + 1))
      return
    }
    const chunks = []
    response.on("data", (chunk) => chunks.push(chunk))
    response.on("end", () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, text: Buffer.concat(chunks).toString() }))
  })
  call.setTimeout(15_000, () => call.destroy(new Error("request timed out")))
  call.on("error", reject)
})
let verified = false

for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    const pageUrl = new URL(siteUrl)
    pageUrl.searchParams.set("deploy_check", Date.now())
    const response = await request(pageUrl)
    const html = response.text
    if (!response.ok) throw new Error(`homepage returned ${response.status}`)
    if (html.includes('"/aaprice/')) throw new Error("homepage still contains the retired /aaprice/ base path")

    const assets = [
      html.match(/href="([^"]+\.css)"/)?.[1],
      html.match(/component-url="([^"]+\.js)"/)?.[1],
    ].filter(Boolean)
    if (assets.length !== 2) throw new Error("homepage is missing its stylesheet or hydrated component")

    for (const asset of assets) {
      const assetResponse = await request(new URL(asset, pageUrl))
      if (!assetResponse.ok) throw new Error(`${asset} returned ${assetResponse.status}`)
    }

    console.log(`Production smoke check passed: ${pageUrl.origin}`)
    verified = true
    break
  } catch (error) {
    if (attempt === 6) throw error
    console.warn(`Production smoke check ${attempt}/6 failed: ${error.message}`)
    await sleep(10_000)
  }
}

if (!verified) process.exitCode = 1
