// frameRms — the mic level behind the wake-word test meter: 0..1 from an
// int16 frame, so "is the microphone alive" is answerable at a glance.
import { describe, it, expect } from 'vitest'
import { frameRms } from './wakeword'

describe('frameRms', () => {
  it('is 0 for silence', () => {
    expect(frameRms(new Int16Array(512))).toBe(0)
  })

  it('is ~1 for a full-scale square wave', () => {
    const frame = new Int16Array(512).fill(32767)
    expect(frameRms(frame)).toBeGreaterThan(0.99)
    expect(frameRms(frame)).toBeLessThanOrEqual(1)
  })

  it('scales monotonically with amplitude', () => {
    const quiet = frameRms(new Int16Array(512).fill(1000))
    const loud = frameRms(new Int16Array(512).fill(10000))
    expect(quiet).toBeGreaterThan(0)
    expect(loud).toBeGreaterThan(quiet)
  })

  it('handles an empty frame without NaN', () => {
    expect(frameRms(new Int16Array(0))).toBe(0)
  })
})
