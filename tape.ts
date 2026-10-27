/* Large trades on Hyperliquid as they happen, from its public websocket. Each coin is its own subscription, so the
   tape listens to a chosen set of coins, keeps the trades above a size, and hands them on in small batches. */
import { toTrade, type Trade } from "./api.js";

export interface TapeOptions {
  coins: readonly string[];
  /** The smallest trade passed on, in USD. */
  minUsd?: number;
  /** The websocket's address. */
  url?: string;
  /** New trades, oldest first. */
  onTrades: (trades: Trade[]) => void;
  onStatus?: (status: "connecting" | "live" | "closed") => void;
  /** A WebSocket implementation, for runtimes without a global one. */
  WebSocket?: typeof WebSocket;
}

export interface Tape {
  setCoins(coins: readonly string[]): void;
  setMinUsd(minUsd: number): void;
  stop(): void;
}

const REMEMBERED = 6000;
// Hyperliquid closes a connection that has heard nothing for a minute.
const PING_EVERY = 45_000;

export function tape(options: TapeOptions): Tape {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const url = options.url ?? "wss://api.hyperliquid.xyz/ws";
  let coins = [...new Set(options.coins)];
  let minUsd = options.minUsd ?? 100_000;
  let socket: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let flush: ReturnType<typeof setTimeout> | undefined;
  let pending: Trade[] = [];
  const seen = new Set<string>();
  const order: string[] = [];

  const send = (message: unknown) => {
    if (socket?.readyState === Socket.OPEN) socket.send(JSON.stringify(message));
  };
  const subscribe = (coin: string, method: "subscribe" | "unsubscribe" = "subscribe") => send({ method, subscription: { type: "trades", coin } });

  function connect() {
    if (stopped) return;
    options.onStatus?.("connecting");
    const current = (socket = new Socket(url));
    current.addEventListener("open", () => {
      if (socket !== current) return;
      retry = 0;
      for (const coin of coins) subscribe(coin);
      clearInterval(ping);
      ping = setInterval(() => send({ method: "ping" }), PING_EVERY);
      options.onStatus?.("live");
    });
    current.addEventListener("message", (event) => {
      if (socket !== current) return;
      let message: { channel?: string; data?: unknown };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.channel !== "trades" || !Array.isArray(message.data)) return;
      for (const row of message.data) {
        const trade = toTrade(row as Record<string, unknown>);
        if (!(trade.usd >= minUsd) || seen.has(trade.id)) continue;
        seen.add(trade.id);
        order.push(trade.id);
        pending.push(trade);
      }
      while (order.length > REMEMBERED) seen.delete(order.shift()!);
      // Trades arrive in bursts; a short wait hands a burst on as one batch.
      if (pending.length && !flush) {
        flush = setTimeout(() => {
          flush = undefined;
          const batch = pending.sort((a, b) => a.time - b.time);
          pending = [];
          options.onTrades(batch);
        }, 250);
      }
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      clearInterval(ping);
      options.onStatus?.("closed");
      if (stopped) return;
      // Back off up to half a minute, so a broken network isn't hammered.
      reconnect = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
    });
    current.addEventListener("error", () => current.close());
  }

  connect();

  return {
    setCoins(next) {
      const wanted = [...new Set(next)];
      for (const coin of coins) if (!wanted.includes(coin)) subscribe(coin, "unsubscribe");
      for (const coin of wanted) if (!coins.includes(coin)) subscribe(coin);
      coins = wanted;
    },
    setMinUsd(value) {
      minUsd = Math.max(0, value);
    },
    stop() {
      stopped = true;
      clearTimeout(reconnect);
      clearTimeout(flush);
      clearInterval(ping);
      socket?.close();
      socket = null;
    },
  };
}
