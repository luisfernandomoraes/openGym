import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScaleRequest, parseScaleAnswer, readWeightFromPhoto } from './scale-ai.js'

const h = vi.hoisted(() => ({ key: 'sk-test', fetch: null }))
vi.mock('./coach-secrets.js', () => ({ secureGet: async () => h.key, secureSet: async () => {}, secureRemove: async () => {} }))
vi.mock('./capacitor-fetch.js', () => ({ nativeFetch: (...args) => h.fetch(...args) }))

const answer = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })

describe('buildScaleRequest', () => {
  it('sends the photo and asks for the weight in the profile unit', () => {
    const body = buildScaleRequest('AAAA', { unit: 'kg', last: 92.4 })
    const [img, txt] = body.messages[0].content
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'AAAA' })
    expect(txt.text).toContain('in kg')
    expect(txt.text).toContain('92.4 kg')
    expect(body.output_config.format.schema.required).toEqual(['weight'])
  })

  it('leaves the last weigh-in out when there is none', () => {
    expect(buildScaleRequest('AAAA').messages[0].content[1].text).not.toContain('last weigh-in')
  })
})

describe('parseScaleAnswer', () => {
  it('reads the weight, to one decimal', () => {
    expect(parseScaleAnswer(answer('{"weight":92.44}'))).toBe(92.4)
  })

  it('gives null for no reading, a refusal, junk, or a value no body weighs', () => {
    expect(parseScaleAnswer(answer('{"weight":null}'))).toBeNull()
    expect(parseScaleAnswer({ stop_reason: 'refusal', content: [] })).toBeNull()
    expect(parseScaleAnswer(answer('not json'))).toBeNull()
    expect(parseScaleAnswer(answer('{"weight":924}'))).toBeNull()
    expect(parseScaleAnswer(null)).toBeNull()
  })

  it('checks the range in the unit asked for', () => {
    expect(parseScaleAnswer(answer('{"weight":203.7}'), 'lb')).toBe(203.7)
    expect(parseScaleAnswer(answer('{"weight":10}'), 'lb')).toBeNull()
  })
})

describe('readWeightFromPhoto', () => {
  const answers = text => async () => ({ ok: true, json: async () => answer(text) })
  const device = vi.fn(async () => [{ text: '81.2', confidence: 1, height: 0.3 }])
  const read = (extra = {}) => readWeightFromPhoto('AAAA', { unit: 'kg', readOnDevice: device, ...extra })

  beforeEach(() => { h.key = 'sk-test'; device.mockClear() })

  it('takes Claude’s reading and leaves the phone out of it', async () => {
    h.fetch = answers('{"weight":92.4}')
    await expect(read()).resolves.toBe(92.4)
    expect(device).not.toHaveBeenCalled()
  })

  it('falls back to the phone with no key, on a failed call, and when Claude found no weight', async () => {
    h.key = null
    await expect(read()).resolves.toBe(81.2)
    h.key = 'sk-test'
    h.fetch = async () => { throw new Error('offline') }
    await expect(read()).resolves.toBe(81.2)
    h.fetch = async () => ({ ok: false, status: 500 })
    await expect(read()).resolves.toBe(81.2)
    h.fetch = answers('{"weight":null}')
    await expect(read()).resolves.toBe(81.2)
  })

  it('a cancelled reading aborts the call and never starts the fallback', async () => {
    const run = new AbortController()
    let seen
    h.fetch = (url, init) => new Promise((_, reject) => {
      seen = init.signal
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
    const reading = read({ signal: run.signal })
    await vi.waitFor(() => expect(seen).toBeTruthy())
    run.abort()
    await expect(reading).resolves.toBeNull()
    expect(seen.aborted).toBe(true)
    expect(device).not.toHaveBeenCalled()
  })

  it('gives up on a call that never answers, and the phone reads it instead', async () => {
    vi.useFakeTimers()
    try {
      h.fetch = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))) })
      const reading = read()
      await vi.advanceTimersByTimeAsync(15000)
      await expect(reading).resolves.toBe(81.2)
    } finally { vi.useRealTimers() }
  })
})
