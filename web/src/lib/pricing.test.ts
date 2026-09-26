/**
 * Pricing tests (§52, §53).
 *
 * These guard the invariants that matter once money is real: that no price is
 * negative, that bands are ordered, that the referral calculation is exact, and
 * that amounts are whole units of currency rather than floats. The last two are
 * the ones that survive into Phase 6 -- see docs/DECISIONS.md D-003.
 */

import { describe, expect, it } from 'vitest'
import type { PricingConfig } from './pricing'
import { money, moneyRange, pricing, referralReward } from './pricing'

describe('pricing configuration', () => {
  it('declares every amount as a non-negative whole number', () => {
    const amounts: Record<string, number> = {
      reporterTrainingFee: pricing.reporterTrainingFee,
      advertisingPerDayMin: pricing.advertisingPerDayMin,
      advertisingPerDayMax: pricing.advertisingPerDayMax,
      surveyPerResponseMin: pricing.surveyPerResponseMin,
      surveyPerResponseMax: pricing.surveyPerResponseMax,
      interviewBooking: pricing.interviewBooking,
      successStoryBooking: pricing.successStoryBooking,
    }

    for (const [name, value] of Object.entries(amounts)) {
      expect(Number.isInteger(value), `${name} must be a whole number`).toBe(true)
      expect(value, `${name} must not be negative`).toBeGreaterThanOrEqual(0)
    }
  })

  it('orders every band from minimum to maximum', () => {
    expect(pricing.advertisingPerDayMin).toBeLessThanOrEqual(pricing.advertisingPerDayMax)
    expect(pricing.surveyPerResponseMin).toBeLessThanOrEqual(pricing.surveyPerResponseMax)
  })

  it('keeps the referral percentage within 0-100', () => {
    expect(pricing.referralRewardPercent).toBeGreaterThanOrEqual(0)
    expect(pricing.referralRewardPercent).toBeLessThanOrEqual(100)
  })

  it('uses an ISO 4217 currency code and a BCP 47 locale', () => {
    expect(pricing.currency).toMatch(/^[A-Z]{3}$/)
    expect(pricing.locale).toMatch(/^[a-z]{2}(-[A-Za-z0-9]+)*$/)
  })
})

describe('referralReward', () => {
  it('computes the configured percentage of the training fee', () => {
    // 20% of 2,500 = 500. Stated explicitly so a config change that breaks the
    // documented promise fails here rather than in production.
    expect(referralReward()).toBe(500)
  })

  it('returns a whole number for percentages that do not divide evenly', () => {
    const odd: PricingConfig = { ...pricing, reporterTrainingFee: 999, referralRewardPercent: 33 }
    const reward = referralReward(odd)

    expect(Number.isInteger(reward)).toBe(true)
    expect(reward).toBe(330) // 999 * 33 / 100 = 329.67, rounded
  })

  it('returns zero when the percentage is zero', () => {
    expect(referralReward({ ...pricing, referralRewardPercent: 0 })).toBe(0)
  })

  it('never exceeds the base it is calculated from', () => {
    const reward = referralReward({ ...pricing, referralRewardPercent: 100 })
    expect(reward).toBe(pricing.reporterTrainingFee)
  })
})

describe('money formatting', () => {
  it('renders an amount in the configured currency', () => {
    const formatted = money(2500)

    expect(formatted).toContain('2,500')
    // Intl may use a narrow or non-breaking space around the symbol; assert the
    // symbol is present rather than pinning an exact byte sequence.
    expect(formatted).toMatch(/₹/)
  })

  it('renders zero without a sign', () => {
    expect(money(0)).not.toContain('-')
  })

  it('renders a band with both endpoints', () => {
    const range = moneyRange(50, 5000)

    expect(range).toContain('50')
    expect(range).toContain('5,000')
  })
})
