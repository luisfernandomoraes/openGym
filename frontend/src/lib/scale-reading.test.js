import { describe, it, expect } from 'vitest'
import { parseScaleReading } from './scale-reading.js'

// Shaped like ScaleReader's output: one entry per recognised line, `height` the line's share of
// the photo's height (the display digits are by far the tallest text on a scale).
const line = (text, height = 0.2, confidence = 0.9) => ({ text, height, confidence })

describe('parseScaleReading', () => {
  it('reads a plain display', () => {
    expect(parseScaleReading([line('92.4')])).toBe(92.4)
  })

  it('takes a comma as the decimal point', () => {
    expect(parseScaleReading([line('92,4 kg')])).toBe(92.4)
  })

  it('turns seven-segment lookalike letters inside a number into digits', () => {
    expect(parseScaleReading([line('9B.4')])).toBe(98.4)
    expect(parseScaleReading([line('O92.4')])).toBe(92.4)
    expect(parseScaleReading([line('S2.l')])).toBe(52.1)
  })

  it('leaves words alone: the unit and the brand are not numbers', () => {
    expect(parseScaleReading([line('kg', 0.05), line('GBS', 0.04)])).toBeNull()
  })

  it('restores a missed decimal point using the last weigh-in', () => {
    expect(parseScaleReading([line('924')], { last: 92 })).toBe(92.4)
  })

  it('closes a gap between segments', () => {
    expect(parseScaleReading([line('9 2.4')], { last: 93 })).toBe(92.4)
  })

  it('prefers the big display digits over small print', () => {
    const lines = [line('150', 0.03), line('86.3', 0.25), line('2024', 0.02)]
    expect(parseScaleReading(lines, { last: 87 })).toBe(86.3)
  })

  it('prefers the weight over a smaller body-fat reading on the same photo', () => {
    expect(parseScaleReading([line('92.0', 0.22), line('23.1%', 0.08)], { last: 91.5 })).toBe(92)
  })

  it('drops numbers that cannot be a body weight in the unit', () => {
    // 3500 is no weight, and neither is 350.0 with its point restored; "999" would be 99.9.
    expect(parseScaleReading([line('5'), line('3500')])).toBeNull()
    expect(parseScaleReading([line('180.6')], { unit: 'lb' })).toBe(180.6)
    expect(parseScaleReading([line('30')], { unit: 'lb' })).toBeNull()
  })

  it('copes with nothing to read', () => {
    expect(parseScaleReading([])).toBeNull()
    expect(parseScaleReading(null)).toBeNull()
    expect(parseScaleReading([{ text: null }])).toBeNull()
  })
})
