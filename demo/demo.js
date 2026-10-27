import { whales } from "../dist/index.js";

const params = new URLSearchParams(location.search);
const tour = params.get("tour");
if (tour) document.documentElement.dataset.tour = tour;

const KEYS = { view: "view", window: "window", wallet: "wallet", sort: "sort", minUsd: "min", topOnly: "top" };
const DEFAULTS = { view: "positions", window: "month", wallet: null, sort: "traders", minUsd: 100000, topOnly: false };

function read() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const state = {};
  for (const [key, name] of Object.entries(KEYS)) {
    const value = hash.get(name);
    if (value === null) continue;
    state[key] = key === "minUsd" ? Number(value) : key === "topOnly" ? value === "1" : value;
  }
  return state;
}

function write(state) {
  const hash = new URLSearchParams();
  for (const [key, name] of Object.entries(KEYS)) {
    const value = state[key];
    if (value === DEFAULTS[key] || value === null) continue;
    hash.set(name, key === "topOnly" ? "1" : String(value));
  }
  const text = hash.toString();
  if (text !== location.hash.slice(1)) history.replaceState(null, "", text ? `#${text}` : location.pathname + location.search);
}

// The recording tour replays what was read from Hyperliquid once (demo/sample), so every loop shows the same thing.
async function recording() {
  const response = await fetch("sample/recorded.json.gz");
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
}

const recorded = tour ? await recording() : null;
const replay = recorded && (await import("./replay.js")).replay(recorded);

const app = whales(document.querySelector("[data-app]"), {
  board: "/board.json",
  ...(replay ? { fetch: replay.fetch, WebSocket: replay.WebSocket, depth: 30 } : {}),
  // The tour shows trades from $10K, so the few seconds it spends on the tape aren't empty.
  state: tour ? { minUsd: 10000 } : read(),
  onStateChange: tour ? undefined : write,
});

if (tour) import("./tour.js").then(({ run }) => run(tour, app));
else addEventListener("hashchange", () => app.setState({ ...DEFAULTS, ...read() }));
