// Cart pricing for the before/after evaluation. All amounts are integer cents.

/** Lines of this quantity or more get a bulk discount. */
export const BULK_QUANTITY = 10;

/** Bulk discount, in percent of the line amount. */
export const BULK_PERCENT = 5;

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING_FROM = 5000;

/** Shipping fee below the free-shipping threshold. */
export const SHIPPING_FEE = 499;

/** Sales tax, in basis points (8.25%). */
export const TAX_BASIS_POINTS = 825;

/** Known coupons. `minimum` is the subtotal the order must reach. */
export const COUPONS = {
	SAVE10: { kind: "percent", value: 10, minimum: 0 },
	FLAT500: { kind: "amount", value: 500, minimum: 2000 },
	FREESHIP: { kind: "shipping", value: 0, minimum: 1000 },
};

/**
 * Round a non-negative amount of cents to whole cents.
 *
 * @param {number} value - Amount, possibly fractional.
 * @returns {number} Whole cents.
 */
export function roundCents(value) {
	return Math.floor(value);
}

/**
 * Price one line.
 *
 * @param {{ unitCents: number, quantity: number }} line - The line.
 * @returns {number} Line amount in cents, after any bulk discount.
 * @throws {RangeError} For a non-integer or negative quantity or price.
 */
export function lineAmount(line) {
	if (!Number.isInteger(line.quantity) || line.quantity < 0) throw new RangeError("quantity must be a non-negative integer");
	if (!Number.isInteger(line.unitCents) || line.unitCents < 0) throw new RangeError("unit price must be a non-negative integer");

	const gross = line.unitCents * line.quantity;

	if (line.quantity >= BULK_QUANTITY) return gross - roundCents((gross * BULK_PERCENT) / 100);

	return gross;
}

/**
 * Price a cart.
 *
 * @param {Array<{ unitCents: number, quantity: number }>} lines - Cart lines.
 * @param {string} [couponCode] - Optional coupon, case-insensitive.
 * @returns {{ subtotal: number, discount: number, shipping: number, tax: number, total: number, coupon: string | null }} The breakdown.
 */
export function priceCart(lines, couponCode) {
	const subtotal = lines.reduce(function sum(acc, line) {
		return acc + lineAmount(line);
	}, 0);
	const code = couponCode ? couponCode.trim().toUpperCase() : null;
	const coupon = code && COUPONS[code] && subtotal >= COUPONS[code].minimum ? COUPONS[code] : null;
	let discount = 0;

	if (coupon?.kind === "percent") discount = roundCents((subtotal * coupon.value) / 100);
	if (coupon?.kind === "amount") discount = Math.min(coupon.value, subtotal);

	const discounted = subtotal - discount;
	const shipping = subtotal === 0 || discounted >= FREE_SHIPPING_FROM || coupon?.kind === "shipping" ? 0 : SHIPPING_FEE;
	const tax = roundCents((discounted * TAX_BASIS_POINTS) / 10000);

	return { subtotal, discount, shipping, tax, total: discounted + shipping + tax, coupon: coupon ? code : null };
}
