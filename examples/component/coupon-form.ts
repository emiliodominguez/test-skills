// A checkout coupon form in three shapes, used as evidence by `test/component-examples.test.ts`.
//
// - `CouponForm` (default): the shipped bug. "Apply" is a styled `span` with a click handler, so it
//   has no button role, is not in the tab order and Enter in the field does nothing.
// - `CouponForm` with `fixed`: a real form with a submit button.
// - `CouponFormRefactored`: the fixed behavior after a harmless refactor (new class names, the label
//   wraps the field, a shared button that does not forward test ids).
import { createElement as h, useState, type FormEvent, type ReactElement } from "react";

/** Props shared by every coupon form variant. */
export interface CouponFormProps {
	/** Receives the normalized code when the shopper applies it. */
	onApply(code: string): void;
	/** Render the corrected variant instead of the shipped bug. */
	fixed?: boolean;
}

/** What the form shows after an attempt. */
type Feedback = { kind: "none" } | { kind: "error"; text: string } | { kind: "applied"; text: string };

/** Message shown when the shopper applies an empty code. */
export const EMPTY_CODE_MESSAGE = "Enter a coupon code";

/**
 * Shared state and submit logic for every variant, so only the markup differs.
 *
 * @param onApply - Callback that receives the normalized code.
 * @returns The current code, its setter, the feedback and the apply action.
 */
function useCoupon(onApply: CouponFormProps["onApply"]): {
	code: string;
	setCode(value: string): void;
	feedback: Feedback;
	apply(): void;
} {
	const [code, setCode] = useState("");
	const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });

	/**
	 * Validate, normalize and apply the current code.
	 */
	function apply(): void {
		const normalized = code.trim().toUpperCase();

		if (normalized === "") {
			setFeedback({ kind: "error", text: EMPTY_CODE_MESSAGE });

			return;
		}

		onApply(normalized);
		setFeedback({ kind: "applied", text: `Coupon ${normalized} applied` });
	}

	return { code, setCode, feedback, apply };
}

/**
 * Render the feedback line with the live-region role that matches its meaning.
 *
 * @param feedback - Current feedback.
 * @param className - Class name for the paragraph.
 * @returns The message element, or null when there is nothing to say.
 */
function renderFeedback(feedback: Feedback, className: string): ReactElement | null {
	if (feedback.kind === "none") return null;

	return h("p", { className, role: feedback.kind === "error" ? "alert" : "status" }, feedback.text);
}

/**
 * The coupon form as shipped (mouse-only "Apply"), or corrected when `fixed` is set.
 *
 * @param props - Callback and variant switch.
 * @returns The form.
 */
export function CouponForm(props: CouponFormProps): ReactElement {
	const coupon = useCoupon(props.onApply);
	const field = [
		h("label", { key: "label", htmlFor: "coupon-code" }, "Coupon code"),
		h("input", {
			key: "input",
			id: "coupon-code",
			className: "coupon-form__input",
			value: coupon.code,
			onChange: function change(event: { target: { value: string } }) {
				coupon.setCode(event.target.value);
			},
		}),
	];
	const message = renderFeedback(coupon.feedback, "coupon-form__message");

	if (!props.fixed) {
		return h(
			"div",
			{ className: "coupon-form" },
			...field,
			h("span", { className: "btn btn-primary", "data-testid": "coupon-apply", onClick: coupon.apply }, "Apply"),
			message,
		);
	}

	return h(
		"form",
		{
			className: "coupon-form",
			onSubmit: function submit(event: FormEvent) {
				event.preventDefault();
				coupon.apply();
			},
		},
		...field,
		h("button", { type: "submit", className: "btn btn-primary", "data-testid": "coupon-apply" }, "Apply"),
		message,
	);
}

/**
 * A design-system button that, like many, does not forward unknown props such as test ids.
 *
 * @param props - The label.
 * @returns A submit button.
 */
function PrimaryButton(props: { label: string }): ReactElement {
	return h("button", { type: "submit", className: "button button--primary" }, props.label);
}

/**
 * The fixed coupon form after a refactor that changes no behavior: renamed classes, an implicit
 * label, and a shared button without the old test id.
 *
 * @param props - Callback; `fixed` is ignored because this variant is always correct.
 * @returns The form.
 */
export function CouponFormRefactored(props: CouponFormProps): ReactElement {
	const coupon = useCoupon(props.onApply);

	return h(
		"form",
		{
			className: "checkout-coupon",
			onSubmit: function submit(event: FormEvent) {
				event.preventDefault();
				coupon.apply();
			},
		},
		h(
			"label",
			{ className: "checkout-coupon__field" },
			h("span", null, "Coupon code"),
			h("input", {
				value: coupon.code,
				onChange: function change(event: { target: { value: string } }) {
					coupon.setCode(event.target.value);
				},
			}),
		),
		h(PrimaryButton, { label: "Apply" }),
		renderFeedback(coupon.feedback, "checkout-coupon__feedback"),
	);
}
