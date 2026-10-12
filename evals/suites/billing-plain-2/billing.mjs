// Subscription billing for the before/after evaluation. Amounts are integer minor units.

/** Minor units per currency; JPY has none. */
export const MINOR_UNITS = { USD: 2, EUR: 2, JPY: 0 };

/** Plans: monthly price in minor units of USD, and seats included. */
export const PLANS = {
	free: { monthly: 0, seats: 1 },
	team: { monthly: 1500, seats: 5 },
	business: { monthly: 4900, seats: 20 },
};

/** Price of each seat beyond the plan's included seats, per month, in USD minor units. */
export const EXTRA_SEAT = 400;

/** Annual billing pays for ten months out of twelve. */
export const ANNUAL_MONTHS_CHARGED = 10;

/** Exchange rates from USD, applied before rounding to the target currency's minor units. */
export const RATES = { USD: 1, EUR: 0.92, JPY: 149.5 };

/** Days a failed payment may stay unpaid before the subscription is suspended. */
export const GRACE_DAYS = 7;

/** Trial length in days for paid plans. */
export const TRIAL_DAYS = 14;

/**
 * Days in the month of a date (UTC).
 *
 * @param {Date} date - Any date in the month.
 * @returns {number} 28 to 31.
 */
export function daysInMonth(date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Convert a USD amount to a currency, rounding half away from zero at its minor units.
 *
 * @param {number} usdMinor - Amount in USD cents.
 * @param {keyof typeof RATES} currency - Target currency.
 * @returns {number} Amount in the currency's minor units.
 */
export function convert(usdMinor, currency) {
	const rate = RATES[currency];

	if (rate === undefined) throw new RangeError(`unsupported currency ${currency}`);

	const major = (usdMinor / 100) * rate;
	const factor = 10 ** MINOR_UNITS[currency];
	const scaled = major * factor;

	return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/**
 * Monthly list price for a plan and a seat count, in USD cents.
 *
 * @param {keyof typeof PLANS} plan - Plan id.
 * @param {number} seats - Seats in use.
 * @returns {number} Monthly price.
 */
export function monthlyPrice(plan, seats) {
	const definition = PLANS[plan];

	if (!definition) throw new RangeError(`unknown plan ${plan}`);
	if (!Number.isInteger(seats) || seats < 1) throw new RangeError("seats must be a positive integer");
	if (plan === "free" && seats > definition.seats) throw new RangeError("the free plan has one seat");

	const extra = Math.max(0, seats - definition.seats);

	return definition.monthly + extra * EXTRA_SEAT;
}

/**
 * Price an invoice for one billing period.
 *
 * @param {{ plan: keyof typeof PLANS, seats: number, interval: "month" | "year", currency: keyof typeof RATES, coupon?: { percent?: number, amountOff?: number, months?: number }, periodIndex?: number }} subscription - The subscription.
 * @returns {{ subtotal: number, discount: number, total: number, currency: string }} Amounts in the currency's minor units.
 */
export function invoice(subscription) {
	const monthly = monthlyPrice(subscription.plan, subscription.seats);
	const usd = subscription.interval === "year" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
	const coupon = subscription.coupon;
	const period = subscription.periodIndex ?? 0;
	const couponActive = coupon !== undefined && (coupon.months === undefined || period < coupon.months);
	let discountUsd = 0;

	if (couponActive && coupon.percent !== undefined) {
		if (coupon.percent <= 0 || coupon.percent > 100) throw new RangeError("percent must be in (0, 100]");
		discountUsd = Math.round((usd * coupon.percent) / 100);
	} else if (couponActive && coupon.amountOff !== undefined) {
		discountUsd = Math.min(coupon.amountOff, usd);
	}

	const subtotal = convert(usd, subscription.currency);
	const discount = convert(discountUsd, subscription.currency);

	return { subtotal, discount, total: subtotal - discount, currency: subscription.currency };
}

/**
 * Prorated charge (positive) or credit (negative) for changing seats or plan mid-month.
 *
 * @param {{ fromMonthly: number, toMonthly: number, changedAt: Date }} change - Monthly prices in USD cents and the change time.
 * @returns {number} USD cents for the rest of the month, rounded half away from zero.
 */
export function prorate(change) {
	const days = daysInMonth(change.changedAt);
	const remaining = days - change.changedAt.getUTCDate() + 1;
	const raw = ((change.toMonthly - change.fromMonthly) * remaining) / days;

	return Math.sign(raw) * Math.round(Math.abs(raw));
}

/**
 * Lifecycle state of a subscription at a moment.
 *
 * @param {{ plan: keyof typeof PLANS, startedAt: Date, canceledAt?: Date, periodEnd: Date, unpaidSince?: Date }} subscription - Dates in UTC.
 * @param {Date} now - The moment to evaluate.
 * @returns {"trialing" | "active" | "past_due" | "suspended" | "canceled"} The state.
 */
export function status(subscription, now) {
	const day = 86_400_000;

	if (subscription.canceledAt && now >= subscription.periodEnd) return "canceled";

	if (subscription.unpaidSince) {
		const unpaidDays = Math.floor((now - subscription.unpaidSince) / day);

		return unpaidDays >= GRACE_DAYS ? "suspended" : "past_due";
	}

	if (subscription.plan !== "free" && now - subscription.startedAt < TRIAL_DAYS * day) return "trialing";

	return "active";
}
