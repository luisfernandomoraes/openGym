// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'

/* A photo of the scale can take seconds on a gym's signal, and it used to show nothing but a
   greyed-out button: it looked frozen. From the moment the photo comes back the sheet shows it,
   says what is going on and offers a way out, and nothing can be saved until it is over. */
const h = vi.hoisted(() => ({ read: null, signal: null }))
vi.mock('./lib/mobile.js', async importOriginal => ({
  ...(await importOriginal()),
  canReadScale: async () => true,
  scaledJpegBase64: async () => 'AAAA',
  readScale: async () => [],
}))
vi.mock('./lib/scale-ai.js', async importOriginal => ({
  ...(await importOriginal()),
  readWeightFromPhoto: (image, opts) => {
    h.signal = opts.signal
    return new Promise((resolve, reject) => { h.read = { resolve, reject } })
  },
}))

const mounted = []
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
async function open() {
  bwSheet()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  await flush()
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const status = host => host.querySelector('.scan-status')
async function takePhoto(host) {
  const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'scale.jpg', { type: 'image/jpeg' })], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}

describe('reading a photo of the scale', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    URL.createObjectURL = vi.fn(() => 'blob:scale')
    URL.revokeObjectURL = vi.fn()
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [] } }))
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('says it is reading, shows the photo and blocks saving from the moment the photo is back', async () => {
    const host = await open()
    expect(status(host)).toBeNull()
    await takePhoto(host)
    expect(status(host).textContent).toContain('Reading the photo…')
    expect(status(host).getAttribute('role')).toBe('status')
    expect(status(host).querySelector('img').getAttribute('src')).toBe('blob:scale')
    expect(host.querySelector('.scan-spin')).toBeTruthy()
    expect(button(host, 'Save').disabled).toBe(true)
    expect(button(host, 'Scan')).toBeUndefined()
    expect(host.querySelector('[aria-busy=true]')).toBeTruthy()
  })

  it('says so when it is taking long', async () => {
    vi.useFakeTimers()
    const host = await open()
    await takePhoto(host)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(status(host).textContent).toContain('Still reading')
  })

  it('fills the field and asks to check it, with the photo still there to check against', async () => {
    const host = await open()
    await takePhoto(host)
    await act(async () => { h.read.resolve(92.4) })
    expect(status(host).textContent).toContain('check it matches')
    expect(status(host).querySelector('img')).toBeTruthy()
    expect(host.querySelector('.scan-spin')).toBeNull()
    expect(host.textContent + [...host.querySelectorAll('input')].map(i => i.value).join(' ')).toContain('92.4')
    expect(button(host, 'Save').disabled).toBe(false)
    expect(button(host, 'Scan')).toBeTruthy()
  })

  it('says what to do when no weight came back, and the same when the reading failed', async () => {
    const host = await open()
    await takePhoto(host)
    await act(async () => { h.read.resolve(null) })
    expect(status(host).textContent).toContain('Could not read the photo')
    expect(button(host, 'Try again')).toBeTruthy()
    expect(button(host, 'Save').disabled).toBe(false)
    await takePhoto(host)
    await act(async () => { h.read.reject(new Error('plugin')) })
    expect(status(host).textContent).toContain('Could not read the photo')
  })

  it('Cancel stops the reading and a late answer changes nothing', async () => {
    const host = await open()
    await takePhoto(host)
    const late = h.read
    act(() => { button(host, 'Cancel').click() })
    expect(h.signal.aborted).toBe(true)
    expect(status(host)).toBeNull()
    expect(button(host, 'Save').disabled).toBe(false)
    await act(async () => { late.resolve(92.4) })
    expect(status(host)).toBeNull()
    expect([...host.querySelectorAll('input')].map(i => i.value).join(' ')).not.toContain('92.4')
  })

  it('leaving the sheet stops the reading and lets the photo go', async () => {
    const host = await open()
    await takePhoto(host)
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    expect(h.signal.aborted).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:scale')
    expect(host.textContent).toBe('')
  })
})
