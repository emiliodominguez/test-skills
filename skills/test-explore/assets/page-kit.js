// Bombadil page kit: load it before the app's own scripts, in test builds only. It never ships.
//
// - Stable test ids: Bombadil replays a click only on an element it can identify by test id, id,
//   role with accessible name, or ARIA label; it ignores text. Reading `data-testid` on an element
//   without one returns a synthesized, stable key, so recorded clicks replay.
// - Injection sentinels: Bombadil answers dialogs itself, so an injected `alert(1)` would pass
//   unseen. Dialog calls, eval, inserted inline scripts and frames, inline handlers, javascript:
//   URLs and CSP violations are recorded in `window.__bombadil.sentinels`.
// - Measurements: in-flight and finished requests, long tasks and slow interactions, for
//   properties to read from `window.__bombadil`.
//
// Load it with a script tag injected by the dev or preview server, an init script in a browser
// driver, or a preload in a desktop shell.
(function installBombadilKit() {
	if (window.__bombadil) return;

	const MAX_LOG = 200;
	const kit = {
		version: 1,
		sentinels: [],
		requests: [],
		inflight: 0,
		lastMutation: performance.now(),
		longTasks: [],
		slowInteractions: [],
	};

	window.__bombadil = kit;

	/**
	 * Append to a bounded log.
	 *
	 * @param {unknown[]} log - Target log.
	 * @param {unknown} entry - Entry to keep.
	 */
	function keep(log, entry) {
		log.push(entry);
		if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
	}

	/**
	 * Record a sentinel hit.
	 *
	 * @param {string} kind - What happened.
	 * @param {string} detail - Short evidence.
	 */
	function sentinel(kind, detail) {
		keep(kit.sentinels, { kind, detail: String(detail).replaceAll(/[\uD800-\uDFFF]/gu, "").slice(0, 160), at: Math.round(performance.now()) });
	}

	// Stable test ids ------------------------------------------------------------------------

	const getAttribute = Element.prototype.getAttribute;
	const TEST_ID = "data-testid";
	let generation = 0;
	let cacheGeneration = -1;
	let cache = new Map();

	/**
	 * A short label from the first non-empty candidate: whitespace collapsed, digits folded to
	 * "#" so changing counts and totals keep the key, at most 60 characters.
	 *
	 * @param {Array<string | null | undefined>} parts - Candidates in priority order.
	 * @returns {string} The label.
	 */
	function stableLabel(parts) {
		const chosen =
			parts.find(function isText(part) {
				return typeof part === "string" && part.trim() !== "";
			}) ?? "";

		return chosen.replaceAll(/\s+/gu, " ").trim().replaceAll(/\d+/gu, "#").slice(0, 60).replaceAll(/[\uD800-\uDFFF]/gu, "");
	}

	/**
	 * The base key of an element: tag, role and stable label.
	 *
	 * @param {Element} element - Element to key.
	 * @returns {string} Base key.
	 */
	function baseKey(element) {
		const read = getAttribute.bind(element);
		const labelledBy = read("aria-labelledby");
		const labelledText = labelledBy
			? labelledBy
					.split(/\s+/u)
					.map(function lookUp(id) {
						return document.getElementById(id)?.textContent ?? "";
					})
					.join(" ")
			: null;
		const forLabel = read("for") ? `for ${read("for")}` : null;
		const fieldLabels = element.labels
			? Array.from(element.labels)
					.map(function labelText(label) {
						return label.textContent ?? "";
					})
					.join(" ")
			: null;
		const label = stableLabel([
			read("aria-label"),
			labelledText,
			fieldLabels,
			read("title"),
			read("name"),
			read("placeholder"),
			forLabel,
			element.textContent,
			element.querySelector?.("img[alt]")?.getAttribute("alt"),
		]);

		return `${element.tagName.toLowerCase()}|${read("role") ?? ""}|${label}`;
	}

	/**
	 * The synthesized key: base key plus the index among connected elements of the same tag with
	 * the same base key. Keys for a whole tag are computed in one pass and reused until the DOM
	 * changes, so reading ids for every candidate stays linear.
	 *
	 * @param {Element} element - Element to key.
	 * @returns {string} Stable key.
	 */
	function keyOf(element) {
		if (cacheGeneration !== generation) {
			cache = new Map();
			cacheGeneration = generation;
		}

		const tag = element.tagName;
		let keys = cache.get(tag);

		if (!keys) {
			const counts = new Map();

			keys = new WeakMap();

			for (const other of document.getElementsByTagName(tag)) {
				const base = baseKey(other);
				const index = counts.get(base) ?? 0;

				counts.set(base, index + 1);
				keys.set(other, `${base}|${index}`);
			}

			cache.set(tag, keys);
		}

		return keys.get(element) ?? `${baseKey(element)}|detached`;
	}

	Element.prototype.getAttribute = function readAttribute(name) {
		const value = getAttribute.call(this, name);

		return value === null && name === TEST_ID && this.isConnected ? keyOf(this) : value;
	};

	// Injection sentinels --------------------------------------------------------------------

	// Native dialogs block the page; a burst of them (an injected onerror firing on every
	// keystroke) stalls Bombadil's quiescence checks. Record the call and answer at once:
	// alert returns, confirm accepts, prompt answers empty, as Bombadil itself would.
	const answers = { alert: undefined, confirm: true, prompt: "" };

	for (const name of Object.keys(answers)) {
		window[name] = function guardedDialog(message) {
			sentinel(name, message);

			return answers[name];
		};
	}

	const open = window.open;

	window.open = function guardedOpen(url, ...rest) {
		sentinel("window.open", url);

		return open.call(window, url, ...rest);
	};

	const evaluate = window.eval;

	window.eval = function guardedEval(source) {
		sentinel("eval", source);

		return evaluate(source);
	};

	const loaded = { done: document.readyState === "complete" };

	window.addEventListener("load", function onLoad() {
		loaded.done = true;
	});

	/**
	 * Inspect an added element and its subtree for live markup an attacker could have injected.
	 *
	 * @param {Element} root - Added element.
	 */
	function inspect(root) {
		const elements = [root, ...root.querySelectorAll("*")];

		for (const element of elements) {
			const tag = element.tagName.toLowerCase();

			if (tag === "script" && loaded.done && !element.src) sentinel("inline script", element.textContent ?? "");
			if ((tag === "iframe" && (element.hasAttribute("srcdoc") || /^javascript:/iu.test(element.getAttribute("src") ?? ""))) || tag === "object" || tag === "embed") sentinel(tag, element.outerHTML);

			for (const attribute of element.attributes) {
				if (/^on/iu.test(attribute.name) && loaded.done) sentinel("inline handler", `${tag} ${attribute.name}=${attribute.value}`);
				if (/^(href|src|action|formaction)$/iu.test(attribute.name) && /^\s*javascript:/iu.test(attribute.value)) sentinel("javascript url", `${tag} ${attribute.value}`);
			}
		}
	}

	new MutationObserver(function onMutations(mutations) {
		generation += 1;
		kit.lastMutation = performance.now();

		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) inspect(node);
			}
		}
	}).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });

	document.addEventListener("securitypolicyviolation", function onViolation(event) {
		sentinel("csp", `${event.violatedDirective} ${event.blockedURI}`);
	});

	// Requests -------------------------------------------------------------------------------

	const fetchOriginal = window.fetch;

	window.fetch = async function measuredFetch(input, init) {
		const started = performance.now();
		const url = typeof input === "string" ? input : (input?.url ?? String(input));

		kit.inflight += 1;

		try {
			const response = await fetchOriginal.call(window, input, init);

			keep(kit.requests, { url, status: response.status, ms: Math.round(performance.now() - started), at: Math.round(started) });

			return response;
		} catch (error) {
			keep(kit.requests, { url, status: 0, ms: Math.round(performance.now() - started), at: Math.round(started) });
			throw error;
		} finally {
			kit.inflight -= 1;
		}
	};

	const send = XMLHttpRequest.prototype.send;
	const openRequest = XMLHttpRequest.prototype.open;

	XMLHttpRequest.prototype.open = function measuredOpen(method, url, ...rest) {
		this.__bombadilUrl = String(url);

		return openRequest.call(this, method, url, ...rest);
	};

	XMLHttpRequest.prototype.send = function measuredSend(body) {
		const started = performance.now();
		const request = this;

		kit.inflight += 1;
		request.addEventListener("loadend", function onEnd() {
			kit.inflight -= 1;
			keep(kit.requests, { url: request.__bombadilUrl, status: request.status, ms: Math.round(performance.now() - started), at: Math.round(started) });
		});

		return send.call(this, body);
	};

	// Responsiveness -------------------------------------------------------------------------

	try {
		new PerformanceObserver(function onLongTasks(list) {
			for (const entry of list.getEntries()) keep(kit.longTasks, { ms: Math.round(entry.duration), at: Math.round(entry.startTime) });
		}).observe({ type: "longtask", buffered: true });

		new PerformanceObserver(function onEvents(list) {
			for (const entry of list.getEntries()) keep(kit.slowInteractions, { name: entry.name, ms: Math.round(entry.duration), at: Math.round(entry.startTime) });
		}).observe({ type: "event", durationThreshold: 104, buffered: true });
	} catch {
		// Older engines without these entry types: properties see empty logs.
	}
})();
