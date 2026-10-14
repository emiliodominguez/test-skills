#!/usr/bin/env node
// Static server for the demo shop. `--fixed` serves the shop with every seeded bug turned off,
// so the same specification can be shown silent on a correct app. `--kit` injects the Bombadil
// page kit before the app's scripts, the way a test build would.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const fixed = process.argv.includes("--fixed");
const withKit = process.argv.includes("--kit");
const kitFile = fileURLToPath(new URL("../../skills/test-explore/assets/page-kit.js", import.meta.url));
const port = Number(process.env.PORT ?? 8765);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/**
 * Serve one request from `public/`, plus a generated `/config.js` with the bug switch.
 *
 * @param {import("node:http").IncomingMessage} request - Incoming request.
 * @param {import("node:http").ServerResponse} response - Outgoing response.
 * @returns {Promise<void>} Resolves when the response is sent.
 */
async function handle(request, response) {
	const path = new URL(request.url ?? "/", "http://localhost").pathname;

	if (path === "/config.js") {
		response.writeHead(200, { "content-type": "text/javascript" });
		response.end(`window.SHOP_FIXED = ${JSON.stringify(fixed)};`);
		return;
	}

	if (path === "/__bombadil/page-kit.js") {
		response.writeHead(200, { "content-type": "text/javascript" });
		response.end(await readFile(kitFile));
		return;
	}

	const file = normalize(join(root, path === "/" ? "index.html" : path));

	if (!file.startsWith(root)) {
		response.writeHead(403).end();
		return;
	}

	try {
		const body = await readFile(file);
		const type = types[extname(file)] ?? "application/octet-stream";

		response.writeHead(200, { "content-type": type });
		response.end(
			withKit && type === "text/html" ? body.toString().replace("<head>", '<head>\n\t\t<script src="/__bombadil/page-kit.js"></script>') : body,
		);
	} catch {
		response.writeHead(404, { "content-type": "text/plain" }).end("not found");
	}
}

createServer(function onRequest(request, response) {
	handle(request, response).catch(function onError() {
		response.writeHead(500).end();
	});
}).listen(port, "127.0.0.1", function onListen() {
	console.log(`buggy-shop (${fixed ? "fixed" : "with bugs"}${withKit ? ", page kit" : ""}) on http://127.0.0.1:${port}/`);
});
