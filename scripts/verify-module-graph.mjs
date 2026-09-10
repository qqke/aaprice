// Inspect emitted chunk references rather than relying on bundler-generated names.
export async function verifyModuleGraph(entryUrl, expectedUrl, request) {
  const origin = new URL(entryUrl).origin
  const pending = [new URL(entryUrl).href]
  const visited = new Set()
  let foundApi = false
  while (pending.length) {
    const url = pending.pop()
    if (visited.has(url)) continue
    if (visited.size >= 100) throw new Error("module graph exceeds the 100 chunk safety limit")
    visited.add(url)
    const response = await request(url)
    if (!response.ok) throw new Error(`module ${url} returned ${response.status}`)
    if (/^\s*</.test(response.text)) throw new Error(`module ${url} returned HTML instead of JavaScript`)
    if (response.text.includes(expectedUrl)) foundApi = true
    for (const match of response.text.matchAll(/["'`](\.{1,2}\/[^"'`\s]+\.js(?:\?[^"'`\s]*)?)["'`]/g)) {
      const dependency = new URL(match[1], url)
      if (dependency.origin !== origin) throw new Error("unexpected cross-origin module")
      pending.push(dependency.href)
    }
  }
  if (!foundApi) throw new Error("production module graph is missing the expected Supabase URL")
  return visited.size
}
