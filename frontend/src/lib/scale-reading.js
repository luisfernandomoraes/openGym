// Picks a body weight out of what the camera read on a bathroom scale's display (the native
// ScaleReader plugin, ios/App/App/ScaleReaderPlugin.swift, returns Vision's raw text lines).
//
// A scale's display is a seven-segment LCD, and text recognition reads it the way it reads
// print: an "8" can come back as "B", a "0" as "O", and the decimal point — a single lit
// segment — is often missed, so "92.4" arrives as "924". The photo also carries the brand name,
// a "kg" or "lb" label and sometimes a body-fat figure. So this does not trust the first number
// it finds: every reading is cleaned up, anything that cannot be a body weight in the unit is
// dropped, and of what is left the biggest text wins (the weight is the largest thing on the
// display), then the one closest to the last weigh-in. The result is only ever put in the
// field for the person to check; nothing is saved from it on its own.

export const RANGE = { kg: [20, 300], lb: [44, 660] }

// Seven-segment glyphs that recognition tends to return as letters.
const LOOKALIKE = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', G: '6', b: '6', B: '8' }

/** The text of one reading with lookalike letters turned into digits, word by word. */
function digitsOf(text) {
  return String(text || '')
    .replace(/,/g, '.')
    .split(/\s+/)
    // Only inside a word that already holds a digit: "9B.4" is 98.4, while "kg" and the brand
    // name stay letters. (No lookbehind here — WebKit before iOS 16.4 cannot even parse it.)
    .map(word => (/\d/.test(word) ? word.replace(/[OoDQIl|iZzSsGbB]/g, c => LOOKALIKE[c]) : word))
    .join(' ')
}

/** Every value a reading could stand for, decimals restored where the point was missed. */
function valuesOf(text, unit) {
  const [lo, hi] = RANGE[unit] || RANGE.kg
  const out = []
  const clean = digitsOf(text)
  // Segments with a wide gap come back as "9 2.4": read the line both as it is and with the
  // gaps between digits closed, so neither "92.4" nor a separate "23.1" body-fat figure is lost.
  const joined = clean.replace(/(\d)\s+(?=\d)/g, '$1')
  const numbers = new Set([...clean.matchAll(/\d+(?:\.\d+)?/g), ...joined.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0]))
  for (const s of numbers) {
    const n = Number(s)
    if (n >= lo && n <= hi) out.push({ value: n, decimal: s.includes('.') })
    // "924" for "92.4": a whole number of three or four digits may be missing its point.
    if (!s.includes('.') && s.length >= 3 && s.length <= 4) {
      const tenth = n / 10
      if (tenth >= lo && tenth <= hi) out.push({ value: tenth, decimal: true, restored: true })
    }
  }
  return out
}

/**
 * The weight a photo of a scale shows, or null when nothing on it can be one.
 * `lines` is ScaleReader's [{ text, confidence, height }]; `last` the last weigh-in (or null),
 * `unit` 'kg' | 'lb'. Returned rounded to 0.1, the precision the weight field keeps.
 */
export function parseScaleReading(lines, { last = null, unit = 'kg' } = {}) {
  const candidates = []
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const c of valuesOf(line?.text, unit)) {
      candidates.push({ ...c, height: Number(line.height) || 0, confidence: Number(line.confidence) || 0 })
    }
  }
  if (!candidates.length) return null
  const tallest = Math.max(...candidates.map(c => c.height))
  const ref = Number(last) > 0 ? Number(last) : null
  const score = c => {
    let s = 0
    // The display's digits dwarf everything else in the photo; anything much smaller is a
    // label, a model number or a second reading such as body fat.
    if (tallest > 0) s += (c.height / tallest) * 4
    if (c.decimal && !c.restored) s += 1
    // A reading close to the last weigh-in is far more likely than one 20 kg away, and that is
    // also what settles "924" between 924 (out of range anyway) and 92.4.
    if (ref) s += Math.max(0, 2 - Math.abs(c.value - ref) / (ref * 0.05))
    s += c.confidence * 0.5
    return s
  }
  candidates.sort((a, b) => score(b) - score(a))
  return Math.round(candidates[0].value * 10) / 10
}
