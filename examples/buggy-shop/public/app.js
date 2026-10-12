// Buggy Shop: a deliberately small store with seeded bugs. Each bug sits behind `seeded(name)`, so
// `node serve.mjs --fixed` serves the same app with every bug turned off.

const products = [
	{ id: "tea", name: "Green tea", cents: 450 },
	{ id: "mug", name: "Stoneware mug", cents: 1290 },
	{ id: "kettle", name: "Gooseneck kettle", cents: 4999 },
	{ id: "beans", name: "Coffee beans", cents: 1575 },
];

/** Largest quantity a line accepts once the bugs are fixed. */
const MAX_QUANTITY = 99;

/** @type {Map<string, number>} Quantity per product id. */
const cart = new Map();
let discountPercent = 0;

/**
 * Whether a seeded bug is active.
 *
 * @param {string} _name - The bug, for readers of the source.
 * @returns {boolean} True unless the server runs with `--fixed`.
 */
function seeded(_name) {
	return window.SHOP_FIXED !== true;
}

/**
 * Format integer cents as dollars.
 *
 * @param {number} cents - Amount in cents.
 * @returns {string} Display text.
 */
function money(cents) {
	return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Line amount for a product and a quantity as typed.
 *
 * @param {{ cents: number }} product - The product.
 * @param {string} typed - Raw quantity input value.
 * @returns {number} Line amount in cents.
 */
function lineCents(product, typed) {
	// Bug "qty-nan": an empty quantity becomes NaN and spreads into the line and the total.
	// Bug "qty-overflow" (found by Bombadil, not planted): a huge quantity overflows safe integers,
	// so the total no longer equals the sum of the lines.
	const quantity = seeded("qty-nan") ? parseInt(typed, 10) : Math.min(MAX_QUANTITY, Math.max(0, parseInt(typed, 10) || 0));

	return product.cents * quantity;
}

/**
 * Recompute and render the total from the rendered lines.
 */
function renderTotal() {
	let sum = 0;

	for (const row of document.querySelectorAll("#cart tbody tr")) sum += Number(row.dataset.cents);

	const total = Math.round(sum * (1 - discountPercent / 100));
	const cell = document.getElementById("total");

	cell.dataset.cents = String(total);
	cell.textContent = money(total);
}

/**
 * Render one cart line.
 *
 * @param {{ id: string, name: string, cents: number }} product - The product.
 * @returns {HTMLTableRowElement} The row.
 */
function renderLine(product) {
	const row = document.createElement("tr");
	const name = document.createElement("td");
	const quantityCell = document.createElement("td");
	const quantity = document.createElement("input");
	const line = document.createElement("td");
	const actions = document.createElement("td");
	const remove = document.createElement("button");

	name.textContent = product.name;
	quantity.type = "number";
	quantity.min = "0";
	if (!seeded("qty-overflow")) quantity.max = String(MAX_QUANTITY);
	quantity.value = String(cart.get(product.id));
	quantity.setAttribute("aria-label", `Quantity of ${product.name}`);
	remove.type = "button";
	remove.textContent = "Remove";
	remove.setAttribute("aria-label", `Remove ${product.name}`);

	/**
	 * Update the line and the total after the quantity changes.
	 */
	function update() {
		const cents = lineCents(product, quantity.value);

		cart.set(product.id, Number(quantity.value));
		row.dataset.cents = String(cents);
		line.textContent = money(cents);
		renderTotal();
	}

	quantity.addEventListener("input", update);
	remove.addEventListener("click", function onRemove() {
		cart.delete(product.id);
		row.remove();
		// Bug "stale-total": removing a line leaves the old total on screen.
		if (!seeded("stale-total")) renderTotal();
	});

	quantityCell.append(quantity);
	actions.append(remove);
	row.append(name, quantityCell, line, actions);
	row.dataset.cents = String(lineCents(product, quantity.value));
	line.textContent = money(Number(row.dataset.cents));

	return row;
}

/**
 * Re-render every cart line and the total.
 */
function renderCart() {
	const body = document.querySelector("#cart tbody");

	body.replaceChildren(
		...products
			.filter(function inCart(product) {
				return cart.has(product.id);
			})
			.map(renderLine),
	);
	renderTotal();
}

/**
 * Apply the typed coupon. Valid coupons look like `SAVE10`.
 */
function applyCoupon() {
	const code = document.getElementById("coupon").value.trim().toUpperCase();
	const message = document.getElementById("coupon-message");
	const match = /^SAVE(\d{1,2})$/.exec(code);

	// Bug "coupon-crash": an invalid code reads a property of null.
	if (seeded("coupon-crash")) {
		discountPercent = Number(match[1]);
	} else if (!match) {
		message.textContent = "That coupon is not valid.";
		return;
	} else {
		discountPercent = Number(match[1]);
	}

	message.textContent = `Coupon applied: ${discountPercent}% off.`;
	renderTotal();
}

/**
 * Show the gift note preview.
 */
function previewNote() {
	const note = document.getElementById("note").value;
	const preview = document.getElementById("note-preview");

	// Bug "note-xss": the note is rendered as HTML.
	if (seeded("note-xss")) preview.innerHTML = note ? `<p>Note: ${note}</p>` : "";
	else preview.textContent = note ? `Note: ${note}` : "";
}

/**
 * Open the confirmation dialog.
 */
function openCheckout() {
	const dialog = document.getElementById("confirm");

	document.getElementById("confirm-summary").textContent = `${cart.size} item(s), total ${document.getElementById("total").textContent}.`;
	document.getElementById("confirm-busy").hidden = true;
	for (const id of ["place", "cancel"]) document.getElementById(id).disabled = false;
	dialog.showModal();
}

/**
 * Place the order: show the spinner, then close the dialog.
 */
function placeOrder() {
	const busy = document.getElementById("confirm-busy");
	const buttons = [document.getElementById("place"), document.getElementById("cancel")];

	busy.hidden = false;
	for (const button of buttons) button.disabled = true;

	// Bug "stuck-spinner": with three or more distinct items the request never settles, and the
	// dialog's buttons stay disabled.
	if (seeded("stuck-spinner") && cart.size >= 3) return;

	setTimeout(function done() {
		busy.hidden = true;
		for (const button of buttons) button.disabled = false;
		cart.clear();
		renderCart();
		document.getElementById("confirm").close();
	}, 600);
}

/**
 * Wire up the page.
 */
function start() {
	const list = document.getElementById("products");

	for (const product of products) {
		const item = document.createElement("li");
		const title = document.createElement("strong");
		const price = document.createElement("p");
		const add = document.createElement("button");

		title.textContent = product.name;
		price.textContent = money(product.cents);
		add.type = "button";
		add.textContent = "Add to cart";
		add.setAttribute("aria-label", `Add ${product.name} to cart`);
		add.addEventListener("click", function onAdd() {
			cart.set(product.id, (cart.get(product.id) ?? 0) + 1);
			renderCart();
		});
		item.append(title, price, add);
		list.append(item);
	}

	document.getElementById("apply").addEventListener("click", applyCoupon);
	document.getElementById("note").addEventListener("input", previewNote);
	document.getElementById("checkout").addEventListener("click", openCheckout);
	document.getElementById("place").addEventListener("click", placeOrder);
	document.getElementById("cancel").addEventListener("click", function onCancel() {
		document.getElementById("confirm").close();
	});
	document.getElementById("confirm").addEventListener("cancel", function onEscape(event) {
		// Bug "escape-dialog": Escape is swallowed, so the dialog cannot be dismissed from the keyboard.
		if (seeded("escape-dialog")) event.preventDefault();
	});

	renderCart();
}

start();
