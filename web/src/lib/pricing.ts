/**
 * Central pricing configuration (Parts VI–XXXIV).
 *
 * Nothing that carries a price is hard-coded into a component. In Phase 2 this
 * module is replaced by a read against the `pricing_config` table, keyed by
 * product, country, currency and effective date — the shape below stays the
 * same so call sites do not change.
 */

export interface PricingConfig {
  currency: string
  locale: string
  /** Reporter training fee, all-inclusive (Part VI). */
  reporterTrainingFee: number
  /** Referral reward as a percentage of the qualifying base (Part VII). */
  referralRewardPercent: number
  /** Advertising day-rate band; exact rate is placement-dependent (Part IX). */
  advertisingPerDayMin: number
  advertisingPerDayMax: number
  /** Survey reward band per valid response (Part XVI). */
  surveyPerResponseMin: number
  surveyPerResponseMax: number
  /** Professional services, excluding applicable taxes (Parts XXIII–XXV). */
  interviewBooking: number
  successStoryBooking: number
}

export const pricing: PricingConfig = {
  currency: 'INR',
  locale: 'en-IN',
  reporterTrainingFee: 2500,
  referralRewardPercent: 20,
  advertisingPerDayMin: 50,
  advertisingPerDayMax: 5000,
  surveyPerResponseMin: 50,
  surveyPerResponseMax: 500,
  interviewBooking: 10000,
  successStoryBooking: 10000,
}

const formatter = new Intl.NumberFormat(pricing.locale, {
  style: 'currency',
  currency: pricing.currency,
  maximumFractionDigits: 0,
})

/** Formats an amount in the configured currency, e.g. ₹2,500. */
export function money(amount: number): string {
  return formatter.format(amount)
}

/** Formats a band, e.g. ₹50 – ₹5,000. */
export function moneyRange(min: number, max: number): string {
  return `${money(min)} – ${money(max)}`
}

/** The referral reward payable on the current training fee (Part VII). */
export function referralReward(config: PricingConfig = pricing): number {
  return Math.round((config.reporterTrainingFee * config.referralRewardPercent) / 100)
}
