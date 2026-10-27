/* Hyperliquid publishes its leaderboard as one file of every trader, close to forty megabytes, with no CORS headers.
   That is too much for a page to read, so a server reads it and keeps the top of each window: condenseBoard does
   that, and runs anywhere (a Vercel function, a Worker, Node). */

export type Window = "day" | "week" | "month" | "allTime";
export const WINDOWS: readonly Window[] = ["day", "week", "month", "allTime"];

/** Where Hyperliquid serves the whole leaderboard. */
export const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

export interface Trader {
  rank: number;
  wallet: string;
  /** The name the trader set, or "". */
  name: string;
  /** USD in the account now, perps and spot. */
  accountValue: number;
  /** Profit and loss over the window, in USD. */
  pnl: number;
  /** Return over the window, as a fraction: 0.25 is 25%. */
  roi: number;
  /** USD traded over the window. */
  volume: number;
}

export interface Board {
  /** When the board was read, in milliseconds. */
  updated: number;
  windows: Record<Window, Trader[]>;
}

export interface RawBoard {
  leaderboardRows: {
    ethAddress: string;
    accountValue: string;
    displayName?: string | null;
    windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
  }[];
}

export interface CondenseOptions {
  /** Traders kept per window. */
  size?: number;
  /** The month's trading volume, in USD, an account needs to count as a trader. Without it the top of every board
   *  is wallets that hold spot and never trade, whose profit is the price of what they hold. */
  minVolume?: number;
}

export function condenseBoard(raw: RawBoard, { size = 1000, minVolume = 100_000 }: CondenseOptions = {}, now = Date.now()): Board {
  const rows = (raw.leaderboardRows ?? []).flatMap((row) => {
    const windows = new Map(row.windowPerformances ?? []);
    const month = windows.get("month");
    if (!month || !(Number(month.vlm) >= minVolume)) return [];
    if (!/^0x[0-9a-fA-F]{40}$/.test(row.ethAddress)) return [];
    return [{ wallet: row.ethAddress.toLowerCase(), name: (row.displayName ?? "").trim(), accountValue: Number(row.accountValue), windows }];
  });

  const windows = {} as Record<Window, Trader[]>;
  for (const window of WINDOWS) {
    const ranked = rows
      .map((row) => {
        const performance = row.windows.get(window);
        return { ...row, pnl: Number(performance?.pnl), roi: Number(performance?.roi), volume: Number(performance?.vlm) };
      })
      .filter((row) => Number.isFinite(row.pnl))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, size);
    windows[window] = ranked.map((row, index) => ({
      rank: index + 1,
      wallet: row.wallet,
      name: row.name,
      accountValue: row.accountValue,
      pnl: row.pnl,
      roi: Number.isFinite(row.roi) ? row.roi : NaN,
      volume: Number.isFinite(row.volume) ? row.volume : NaN,
    }));
  }
  return { updated: now, windows };
}
