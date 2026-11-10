// Serves the extension folder so the preview page can load the same modules the
// extension ships. Dev only; nothing in the manifest refers to it.
//   node extensions/zephium-focus/scripts/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] ?? 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/demo/index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      // The preview is shown in a frame; the extension itself needs no such
      // relaxation because it is not served over HTTP at all.
      "x-frame-options": "ALLOWALL",
      "content-security-policy": "frame-ancestors *",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500).end(String(error?.message ?? error));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Zephium Focus preview on http://0.0.0.0:${PORT}/`);
});
