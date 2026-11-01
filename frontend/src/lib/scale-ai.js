// Reads a photo of a bathroom scale with Claude, straight from the phone with the user's own
// Anthropic key — no openGym server in the way, so it works at the gym too. The on-device
// reading (ScaleReader + lib/scale-reading.js) stays the fallback: no key, no network, or an
// answer that is not a weight.
//
// The key lives in the phone's secure storage under its own name (coach-secrets.js), never in
// S. The call goes through nativeFetch, as the Coach's does: the WebView's capacitor:// origin
// would otherwise depend on the provider's CORS answer.
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'
import { nativeFetch } from './capacitor-fetch.js'
import { RANGE, parseScaleReading } from './scale-reading.js'

export const SCALE_KEY = 'scale.anthropicKey'
export const SCALE_MODEL = 'claude-opus-5-5'
const ANTHROPIC_VERSION = '2023-06-01'
// A gym's weak signal must not hold the person at the scale: past this the on-device reading,
// which is nearly instant, takes over.
export const TIMEOUT_MS = 15000

export const getScaleKey = () => secureGet(SCALE_KEY)
export const setScaleKey = value => secureSet(SCALE_KEY, value)
export const clearScaleKey = () => secureRemove(SCALE_KEY)

/** The Messages API body for one photo: the weight back as JSON, null when none is legible. */
export function buildScaleRequest(base64, { unit = 'kg', last = null } = {}) {
  const hint = last ? ` The last weigh-in was ${last} ${unit}; use it only to settle a doubtful digit, never as the answer.` : ''
  return {
    model: SCALE_MODEL,
    max_tokens: 4000,
    // A display has a handful of digits: no deliberation needed, and the answer comes back sooner.
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { weight: { type: ['number', 'null'] } },
          required: ['weight'],
          additionalProperties: false,
        },
      },
    },
    // A declined request is re-run on the model Anthropic recommends instead of coming back empty.
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: `This is a photo of a bathroom scale's display. Read the body weight it shows, in ${unit}, as a number with its decimal (a seven-segment display may show the decimal point as a single small dot). If no weight is legible, answer null.${hint}` },
      ],
    }],
  }
}

/** The weight out of a Messages API response, or null for a refusal, junk, or a value no body weighs. */
export function parseScaleAnswer(data, unit = 'kg') {
  if (!data || data.stop_reason === 'refusal') return null
  const text = (data.content || []).filter(b => b?.type === 'text').map(b => b.text).join('')
  let w
  try { w = JSON.parse(text).weight } catch { return null }
  const [min, max] = RANGE[unit] || RANGE.kg
  return typeof w === 'number' && w >= min && w <= max ? Math.round(w * 10) / 10 : null
}

/** Throws when there is no key or the call fails, so the caller can fall back to the on-device reading. */
export async function readScaleWithClaude(base64, opts = {}) {
  const key = await getScaleKey()
  if (!key) throw new Error('no key')
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const cancel = () => ctrl.abort()
  if (opts.signal?.aborted) cancel(); else opts.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const res = await nativeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildScaleRequest(base64, opts)),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return parseScaleAnswer(await res.json(), opts.unit)
  } finally { clearTimeout(tm); opts.signal?.removeEventListener('abort', cancel) }
}

/**
 * The whole reading of one photo: Claude, then the phone itself when Claude has no key, no
 * network, or found no weight. A cancelled reading (`signal`) ends here with null and never
 * starts the fallback. `readOnDevice` is passed in because it lives behind the native plugin.
 */
export async function readWeightFromPhoto(image, { unit = 'kg', last = null, signal, readOnDevice }) {
  let w = null
  try { w = await readScaleWithClaude(image, { unit, last, signal }) } catch { /* the fallback's turn */ }
  if (w || signal?.aborted) return w
  const lines = await readOnDevice(image)
  return signal?.aborted ? null : parseScaleReading(lines, { last, unit })
}
