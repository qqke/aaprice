export function parseShelfPrice(text, confidence = 0) {
  const normalized = String(text || "").normalize("NFKC")
  const amounts = [...normalized.matchAll(/(?:[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{1,6})(?![\d.,])|(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{1,6})\s*円)/g)]
    .map((match) => ({ price: Number((match[1] || match[2]).replaceAll(",", "")), index: match.index }))
    .filter(({ price }) => price > 0 && price <= 100000)
  const taxed = amounts.filter(({ index }) => /税込|税\s*込/.test(normalized.slice(Math.max(0, index - 12), index)))
  const choices = [...new Set((taxed.length ? taxed : amounts).map(({ price }) => price))]
  if (choices.length !== 1) {
    // ponytail: damaged currency glyphs use a tax-pair suggestion only, never automatic saving.
    const numbers = [...new Set([...normalized.matchAll(/(?<![\d.,])(\d{1,3}(?:[,.]\d{3})+|\d{2,6})(?![\d.,])/g)]
      .map((match) => Number(match[1].replaceAll(",", "").replaceAll(".", "")))
      .filter((value) => value >= 50 && value <= 100000))].sort((a, b) => a - b)
    const pair = numbers.length === 2 && [1.08, 1.1].some((rate) => Math.abs(numbers[0] * rate - numbers[1]) <= 1)
    return { price: pair ? String(numbers[1]) : "", automatic: false }
  }
  return { price: String(choices[0]), automatic: taxed.length > 0 && confidence >= 80 }
}
