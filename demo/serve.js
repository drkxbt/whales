// A zero-dependency server for the demo: `npm run demo`, then open http://localhost:4332/demo/. Besides the files it
// serves /board.json, Hyperliquid's leaderboard condensed to the top of each window: the full file is too big for
// a page to read and has no CORS headers, so a server has to do this part.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { condenseBoard, LEADERBOARD_URL } from "../dist/board.js";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 4332);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gz": "application/gzip",
};

// The leaderboard changes slowly; five minutes between reads is plenty.
let board = null;
async function readBoard() {
  if (board && Date.now() - board.at < 300_000) return board.body;
  const response = await fetch(LEADERBOARD_URL);
  if (!response.ok) throw new Error(`the leaderboard answered ${response.status}`);
  const body = JSON.stringify(condenseBoard(await response.json()));
  board = { at: Date.now(), body };
  return body;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/board.json") {
    try {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }).end(await readBoard());
    } catch (error) {
      console.error("board:", error.message);
      response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "The leaderboard is unavailable right now." }));
    }
    return;
  }
  // The demo links its files relative to /demo/, so the root has to redirect rather than serve the page in place.
  if (url.pathname === "/" || url.pathname === "/demo") {
    response.writeHead(302, { location: "/demo/" }).end();
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  // Only files inside the repo are served.
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`whales demo: http://localhost:${PORT}/demo/`));
