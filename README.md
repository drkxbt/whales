# whales

See how Hyperliquid's best traders are positioned. Positions adds up the open perp positions of the top wallets on the board, coin by coin: how many are long and how many short, how much sits on each side, their average entry and leverage, and how much they are up. The tape shows every large trade on the busiest coins as it happens, with a star on the ones from traders on the board. Open any wallet for its positions, its profit over the month, its record and its fills. Everything comes from Hyperliquid's public API, with no key and no account. Plain TypeScript, no dependencies.

![A MacBook and an iPhone running the tracker in Safari: Positions lists the coins the month's top thirty traders hold, HYPE opens to show who is long and who is short with their value, entry, liquidation price and leverage, the second biggest holder's wallet opens in a card in the middle of the screen with its account, leverage, monthly profit and open positions, the tape fills with trades of $10K and up and narrows to traders on the board, and the board ranks the month's top traders; on the iPhone the wallet rises from the bottom as a sheet](demo/preview.webp)

Trackers of Hyperliquid's top wallets usually keep the useful parts behind a paid plan: where the big accounts are positioned, alerts when they trade, more than a handful of wallets. This one is MIT licensed: use it in a product, change it, ship it.

- **Positions.** The open perp positions of the board's top traders, added up by coin: the number of traders long and short, the value on each side as a bar, the average entry on each side weighted by size, the open profit, and every holder with their value, entry, liquidation price and leverage. Sort by the most traders, the most money, the most long, the most short or the most in profit. Every coin carries the logo Hyperliquid's own app shows for it.
- **The tape.** Every trade of $10K, $50K, $100K, $500K or $1M and up on the thirty busiest coins, straight from Hyperliquid's websocket. Narrow it to traders on the board, and turn on browser notifications for their large trades.
- **Wallets.** Account value, how much sits in positions, leverage and margin; profit on perps over the last thirty days; every open position with size, entry, mark, liquidation price and leverage; a win rate over the latest fills that closed something; and those fills, from "Open Long" to "Close Short", with what each realized. Spot fills are named by their tokens, as in UBTC/USDC.
- **The board.** Hyperliquid's leaderboard, its top 1000 by profit for today, this week, this month or all time, with return, account value and volume. Accounts that trade less than $100K a month are left out: they mostly hold spot, and their profit is the price of what they hold. Every wallet gets an avatar drawn from its address: its own, and the same everywhere.
- **Twenty to a page.** Every list, from the coins and their holders to the tape, the board, a wallet's positions and its fills, shows twenty at a time with page numbers under it.
- **Shareable.** The view, window, sort, tape size and open wallet are plain state, handed to you on every change, so a page can keep them in its URL.
- **Gentle on the API.** Hyperliquid allows each IP a weight of 1200 a minute. Reads share a cache, identical reads made at once share one request, at most six run at a time, and a `429` waits before trying again.
- **Accessible.** The views are tabs, the filters are toggle buttons, every icon button has a label, tables have headers, and a wallet opens in a modal dialog that keeps focus and closes with Escape or a click outside it. On a phone the dialog is a sheet from the bottom that a pull on its top closes.
- **Content Security Policy.** Nothing writes a `style` attribute or a `<style>` tag, and nothing loads an image. The page needs `connect-src https://api.hyperliquid.xyz wss://api.hyperliquid.xyz` and the address of your board.

## Install

The package is not on npm. Install it from GitHub, which builds it on the way in:

```bash
npm install github:drkxbt/whales
```

It installs as `@drkxbt/whales`. Import it and its stylesheet:

```js
import { whales } from "@drkxbt/whales";
import "@drkxbt/whales/whales.css";
```

## The board needs a server

Hyperliquid publishes its leaderboard as one file of every trader, close to forty megabytes, without CORS headers, so a browser can't read it. Serve a condensed copy from your own host: `condenseBoard` keeps the top 1000 of each window. On Vercel:

```js
// api/board.js
import { condenseBoard, LEADERBOARD_URL } from "@drkxbt/whales/board";

export default async function handler(request, response) {
  const raw = await (await fetch(LEADERBOARD_URL)).json();
  response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  response.status(200).json(condenseBoard(raw));
}
```

Then point the tracker at it. Everything else is read straight from Hyperliquid by the visitor's browser.

## Usage

```js
const app = whales(document.querySelector("#whales"), {
  board: "/api/board",
  state: { view: "positions", window: "week" },
  onStateChange(state) {
    // Keep it in the URL, say.
  },
});

app.setState({ view: "tape", minUsd: 500_000, topOnly: true });
app.openWallet("0x…");
app.destroy();
```

| Option | Default | |
| - | - | - |
| `board` | | The address of the condensed board. Required in a browser. |
| `state` | Positions, month | Where to start: `view` (`"positions"`, `"tape"`, `"board"`), `window` (`"day"`, `"week"`, `"month"`, `"allTime"`), `wallet`, `sort` (`"traders"`, `"notional"`, `"long"`, `"short"`, `"pnl"`), `minUsd`, `topOnly`. |
| `depth` | `200` | How many of the board's top traders Positions reads, up to 300. Each is a read of weight 2 against Hyperliquid's 1200 a minute per visitor. |
| `coins` | `30` | How many of the busiest coins the tape listens to. |
| `live` | `true` | Listen for trades while the tape is showing. |
| `coinIcon` | Hyperliquid's logos | `(coin) => url` for each perp's logo, or `false` for the coin's first letter only. |
| `theme` | light | `"dark"`, or `"auto"` to follow the system. |
| `info`, `socket` | Hyperliquid | The info API and websocket addresses. |
| `fetch`, `WebSocket`, `concurrency`, `ttl` | | For other runtimes, tests and recordings. |
| `api` | | A client to share with the rest of your page. |

### Just the data

The client and the analysis work without the interface, in the browser or in Node 18 and later:

```js
import { client, positioning, sortPositioning, fillRecord, tape } from "@drkxbt/whales";

const api = client(); // In Node it reads and condenses the full leaderboard itself.
const board = await api.board();
const markets = new Map((await api.markets()).map((market) => [market.coin, market]));
const holdings = await Promise.all(board.windows.week.slice(0, 50).map(async (trader) => ({ trader, positions: (await api.account(trader.wallet)).positions })));
const coins = sortPositioning(positioning(holdings, markets, { minValue: 1000 }), "short");

const record = fillRecord(await api.fills(board.windows.week[0].wallet));

const feed = tape({ coins: ["BTC", "ETH", "HYPE"], minUsd: 250_000, onTrades: (trades) => console.log(trades) });
```

Every number comes back as a JavaScript number, every time in milliseconds, and every wallet in lower case. A value the API didn't give is `NaN`, never zero.

## Theming

Every colour and size is a custom property on `.wh`, such as `--wh-bg`, `--wh-text`, `--wh-long`, `--wh-short`, `--wh-up`, `--wh-down` and `--wh-radius`. Set them on the container or a parent to restyle it.

## How it works

- Positions reads the top traders' accounts (`clearinghouseState`, a weight of 2 each), keeps the positions worth $1,000 or more, and adds them up by coin and side. The average entry is weighted by size and the average leverage by value. Mark prices and 24-hour changes come from `metaAndAssetCtxs`.
- The tape subscribes to the `trades` channel of each of the busiest coins by 24-hour volume. Every trade names its buyer and seller, so a trade is shown under whichever of them is on the board, or under the taker.
- Logos come from where Hyperliquid's app keeps them (`app.hyperliquid.xyz/coins`), loaded by the browser as a list shows them; a coin without one keeps its first letter. Fills name a spot pair by an index (`@107`), so for a wallet that trades spot the client also reads `spotMeta` once for the tokens' names.
- A wallet's profit chart is the `perpMonth` series of `portfolio`, which leaves out spot. Its record counts the fills among its latest 2000 (`userFills`) that realized a profit or a loss; fills within a dollar of even count as neither.

## What it doesn't do yet

- A wallet's fills stop at the latest 2000, the most `userFills` returns.
- Builder-deployed perps (HIP-3) and spot positions are left out.
- The tape listens to the thirty busiest coins, where almost all large trades happen; a large trade on a quiet coin isn't shown.

## Demo

```bash
git clone https://github.com/drkxbt/whales
cd whales
npm install
npm run demo
```

Then open http://localhost:4332/demo/. The demo server condenses the board itself, and the page reads live data. `demo/tour.html` plays the preview above on a MacBook and an iPhone, replaying reads and trades recorded from Hyperliquid on October 27, 2026 (UTC) (`demo/sample/recorded.json.gz`) so that every loop shows the same thing.

## Tests

```bash
npm test
```

The tests cover the formatting, condensing the board, the mapping of API answers, positioning and its sorts, the record, the client's requests, cache and retries, and the tape's subscriptions, filtering and batching.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with Hyperliquid. Past profit says nothing certain about the next trade, and nothing here is advice.
