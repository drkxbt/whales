/* A small client for Hyperliquid's public info API. Every read here is public and needs no key. Hyperliquid limits
   each IP to a weight of 1200 a minute (2 for an account's state, 20 for most other reads), so the client caps
   requests in flight, caches answers briefly, shares identical requests made at once, and waits out a 429. */
import { condenseBoard, LEADERBOARD_URL, type Board, type RawBoard, type Trader, type Window } from "./board.js";

export type { Board, Trader, Window };

export interface Market {
  coin: string;
  /** Mark price in USD. */
  mark: number;
  /** The price 24 hours ago. */
  prevDay: number;
  /** The change over 24 hours, as a fraction. */
  change: number;
  /** The funding rate per hour, as a fraction. */
  funding: number;
  /** Open interest in USD at the mark price. */
  openInterest: number;
  /** USD traded over 24 hours. */
  dayVolume: number;
  maxLeverage: number;
}

export interface Position {
  wallet: string;
  coin: string;
  side: "long" | "short";
  /** Size in the coin, always positive. */
  size: number;
  /** Average entry price. */
  entry: number;
  /** USD value of the position at the mark price. */
  value: number;
  /** The mark price the value was taken at. */
  mark: number;
  /** Open profit or loss in USD. */
  upnl: number;
  /** Return on the margin, as a fraction. */
  roe: number;
  /** The price at which it is liquidated; NaN when there is none, as for a fully backed position. */
  liquidation: number;
  leverage: number;
  leverageType: "cross" | "isolated";
  margin: number;
  /** Funding paid since the position opened, in USD; negative when it was received. */
  funding: number;
}

export interface Account {
  wallet: string;
  /** USD in the perp account. */
  accountValue: number;
  marginUsed: number;
  /** USD value of all open positions. */
  notional: number;
  withdrawable: number;
  positions: Position[];
}

export interface Fill {
  /** Unique: the transaction and the trade id. */
  id: string;
  coin: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  usd: number;
  time: number;
  /** What the fill did, as Hyperliquid names it: "Open Long", "Close Short"… */
  direction: string;
  /** Profit or loss the fill realized, in USD. */
  closedPnl: number;
  fee: number;
}

export interface SpotPair {
  /** The pair as fills name it: "PURR/USDC" for the first, "@" and an index for the rest. */
  coin: string;
  /** The base and quote tokens, as in "UBTC/USDC". */
  name: string;
  /** The base token's logo. */
  icon: string;
}

export interface Trade {
  id: string;
  coin: string;
  /** The taker's side. */
  side: "buy" | "sell";
  price: number;
  size: number;
  usd: number;
  time: number;
  buyer: string;
  seller: string;
}

export interface PnlPoint {
  time: number;
  pnl: number;
}

export interface ClientOptions {
  /** The info API's address. */
  info?: string;
  /** Where to read the board: an address serving the output of condenseBoard (see the README). Left out, the
   *  client reads Hyperliquid's whole leaderboard and condenses it itself, which works in Node but not in a
   *  browser: that file is huge and has no CORS headers. */
  board?: string;
  fetch?: typeof fetch;
  /** Requests in flight at once. */
  concurrency?: number;
  /** How long an answer is reused, in milliseconds. */
  ttl?: number;
}

interface Read {
  signal?: AbortSignal;
}

export interface Client {
  board(options?: Read): Promise<Board>;
  markets(options?: Read): Promise<Market[]>;
  account(wallet: string, options?: Read): Promise<Account>;
  /** Profit on perps over a window, as a series. */
  pnl(wallet: string, options?: Read & { window?: Window }): Promise<PnlPoint[]>;
  /** A wallet's latest fills, newest first: up to 2000. */
  fills(wallet: string, options?: Read): Promise<Fill[]>;
  /** The last few trades on a coin, newest first. */
  recentTrades(coin: string, options?: Read): Promise<Trade[]>;
  /** Spot pairs by the name fills give them. */
  spotPairs(options?: Read): Promise<Map<string, SpotPair>>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
};
const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function isWallet(value: string): boolean {
  return WALLET.test(value);
}

/** Where Hyperliquid's own app keeps a coin's logo. Coins quoted per thousand, like kPEPE, use the coin's. A coin
 *  without one gets the app's HTML page back, which an image element fails to load. */
export function coinIcon(coin: string): string {
  return `https://app.hyperliquid.xyz/coins/${encodeURIComponent(coin.replace(/^k(?=[A-Z])/, ""))}.svg`;
}

/** A board as a server sent it: JSON has no NaN, so a missing number arrives as null and is read back as NaN. */
export function toBoard(body: unknown): Board {
  const data = (body ?? {}) as Row;
  const windows = (data.windows ?? {}) as Record<string, Row[]>;
  const traders = (rows: unknown): Trader[] =>
    (Array.isArray(rows) ? (rows as Row[]) : []).map((row) => ({
      rank: num(row.rank),
      wallet: str(row.wallet).toLowerCase(),
      name: str(row.name),
      accountValue: num(row.accountValue),
      pnl: num(row.pnl),
      roi: num(row.roi),
      volume: num(row.volume),
    }));
  return { updated: num(data.updated), windows: { day: traders(windows.day), week: traders(windows.week), month: traders(windows.month), allTime: traders(windows.allTime) } };
}

export function toMarkets(body: unknown): Market[] {
  const [meta, contexts] = Array.isArray(body) ? (body as [Row, Row[]]) : [{}, []];
  const universe = Array.isArray(meta?.universe) ? (meta.universe as Row[]) : [];
  return universe.flatMap((asset, index) => {
    const context = (contexts?.[index] ?? {}) as Row;
    if (asset.isDelisted === true) return [];
    const mark = num(context.markPx);
    const prevDay = num(context.prevDayPx);
    return [{
      coin: str(asset.name),
      mark,
      prevDay,
      change: prevDay > 0 ? mark / prevDay - 1 : NaN,
      funding: num(context.funding),
      openInterest: num(context.openInterest) * mark,
      dayVolume: num(context.dayNtlVlm),
      maxLeverage: num(asset.maxLeverage),
    }];
  });
}

export function toAccount(wallet: string, body: unknown): Account {
  const state = (body ?? {}) as Row;
  const summary = (state.marginSummary ?? {}) as Row;
  const positions = (Array.isArray(state.assetPositions) ? (state.assetPositions as Row[]) : []).flatMap((entry) => {
    const position = (entry.position ?? {}) as Row;
    const signed = num(position.szi);
    if (!signed) return [];
    const size = Math.abs(signed);
    const value = num(position.positionValue);
    const leverage = (position.leverage ?? {}) as Row;
    const funding = (position.cumFunding ?? {}) as Row;
    return [{
      wallet: wallet.toLowerCase(),
      coin: str(position.coin),
      side: signed > 0 ? ("long" as const) : ("short" as const),
      size,
      entry: num(position.entryPx),
      value,
      mark: size > 0 ? value / size : NaN,
      upnl: num(position.unrealizedPnl),
      roe: num(position.returnOnEquity),
      liquidation: num(position.liquidationPx),
      leverage: num(leverage.value),
      leverageType: leverage.type === "isolated" ? ("isolated" as const) : ("cross" as const),
      margin: num(position.marginUsed),
      funding: num(funding.sinceOpen),
    }];
  });
  return {
    wallet: wallet.toLowerCase(),
    accountValue: num(summary.accountValue),
    marginUsed: num(summary.totalMarginUsed),
    notional: num(summary.totalNtlPos),
    withdrawable: num(state.withdrawable),
    positions: positions.sort((a, b) => b.value - a.value),
  };
}

export function toSpotPairs(body: unknown): Map<string, SpotPair> {
  const meta = (body ?? {}) as { tokens?: Row[]; universe?: Row[] };
  const tokens = new Map((meta.tokens ?? []).map((token) => [num(token.index), token]));
  const pairs = new Map<string, SpotPair>();
  for (const pair of meta.universe ?? []) {
    const [base, quote] = (Array.isArray(pair.tokens) ? pair.tokens : []).map((index) => tokens.get(num(index)));
    if (!base || !quote) continue;
    const coin = str(pair.name);
    const baseName = str(base.name);
    // Unit's tokens (UBTC is "Unit Bitcoin") carry a coin that has a perp, and Hyperliquid keeps no logo of their own.
    const icon = /^Unit /.test(str(base.fullName)) ? coinIcon(baseName.slice(1)) : `https://app.hyperliquid.xyz/coins/${encodeURIComponent(baseName)}_spot.svg`;
    pairs.set(coin, { coin, name: `${baseName}/${str(quote.name)}`, icon });
  }
  return pairs;
}

export function toFill(row: Row): Fill {
  const price = num(row.px);
  const size = num(row.sz);
  return {
    id: `${str(row.hash)}:${str(row.tid)}`,
    coin: str(row.coin),
    side: row.side === "B" ? "buy" : "sell",
    price,
    size,
    usd: price * size,
    time: num(row.time),
    direction: str(row.dir),
    closedPnl: num(row.closedPnl),
    fee: num(row.fee),
  };
}

export function toTrade(row: Row): Trade {
  const price = num(row.px);
  const size = num(row.sz);
  const users = Array.isArray(row.users) ? (row.users as unknown[]).map((user) => str(user).toLowerCase()) : [];
  return {
    id: `${str(row.hash)}:${str(row.tid)}`,
    coin: str(row.coin),
    side: row.side === "B" ? "buy" : "sell",
    price,
    size,
    usd: price * size,
    time: num(row.time),
    buyer: users[0] ?? "",
    seller: users[1] ?? "",
  };
}

export function toPnl(body: unknown, window: Window): PnlPoint[] {
  const series = new Map(Array.isArray(body) ? (body as [string, Row][]) : []);
  // The perp series leave out spot, whose swings would read as trading profit.
  const name = `perp${window[0].toUpperCase()}${window.slice(1)}`;
  const history = ((series.get(name) ?? series.get(window) ?? {}) as Row).pnlHistory;
  return (Array.isArray(history) ? (history as [number, string][]) : [])
    .map(([time, pnl]) => ({ time: num(time), pnl: num(pnl) }))
    .filter((point) => Number.isFinite(point.pnl));
}

export function client(options: ClientOptions = {}): Client {
  const infoUrl = options.info ?? "https://api.hyperliquid.xyz/info";
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ttl = options.ttl ?? 30_000;
  const limit = Math.max(1, options.concurrency ?? 6);

  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const queue: (() => void)[] = [];
  let active = 0;

  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await work();
    } finally {
      active--;
      queue.shift()?.();
    }
  }

  async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await slot(() => doFetch(url, { ...init, signal }));
      } catch (error) {
        if (signal?.aborted || attempt >= 2) throw error;
        await wait(400 * (attempt + 1), signal);
        continue;
      }
      if (response.ok) return response.json();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const after = Number(response.headers.get("retry-after"));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * (attempt + 1), signal);
        continue;
      }
      throw new ApiError(`${response.status} from ${url}`, response.status);
    }
  }

  function remember(key: string, age: number, read: () => Promise<unknown>): Promise<unknown> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < age) return hit.value;
    const value = read();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.get(key)?.value === value && cache.delete(key));
    return value;
  }

  const info = (body: Row, signal?: AbortSignal, age = ttl) => {
    const text = JSON.stringify(body);
    return remember(text, age, () => request(infoUrl, { method: "POST", headers: { "content-type": "application/json" }, body: text }, signal));
  };

  return {
    async board({ signal } = {}) {
      if (options.board) return toBoard(await remember(options.board, 60_000, () => request(options.board!, { headers: { accept: "application/json" } }, signal)));
      const raw = (await remember(LEADERBOARD_URL, 300_000, () => request(LEADERBOARD_URL, {}, signal))) as RawBoard;
      return condenseBoard(raw);
    },

    async markets({ signal } = {}) {
      return toMarkets(await info({ type: "metaAndAssetCtxs" }, signal, 15_000));
    },

    async account(wallet, { signal } = {}) {
      return toAccount(wallet, await info({ type: "clearinghouseState", user: wallet }, signal));
    },

    async pnl(wallet, { window = "month", signal } = {}) {
      return toPnl(await info({ type: "portfolio", user: wallet }, signal, 60_000), window);
    },

    async fills(wallet, { signal } = {}) {
      const rows = (await info({ type: "userFills", user: wallet, aggregateByTime: true }, signal)) as Row[];
      return (Array.isArray(rows) ? rows : []).map(toFill).sort((a, b) => b.time - a.time);
    },

    async recentTrades(coin, { signal } = {}) {
      const rows = (await info({ type: "recentTrades", coin }, signal, 5_000)) as Row[];
      return (Array.isArray(rows) ? rows : []).map(toTrade).sort((a, b) => b.time - a.time);
    },

    async spotPairs({ signal } = {}) {
      return toSpotPairs(await info({ type: "spotMeta" }, signal, 600_000));
    },
  };
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
