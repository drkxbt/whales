/* The analysis, kept apart from the network and the page so it can be tested on plain data. */
import type { Fill, Market, Position, Trader } from "./api.js";

export interface Holding {
  trader: Trader;
  position: Position;
}

export interface SideSummary {
  traders: number;
  /** USD value at the mark price. */
  notional: number;
  /** Size in the coin. */
  size: number;
  /** Average entry, weighted by size. */
  entry: number;
  /** Open profit or loss in USD. */
  upnl: number;
  /** Average leverage, weighted by value. */
  leverage: number;
}

export interface CoinRow {
  coin: string;
  mark: number;
  /** Change over 24 hours, as a fraction. */
  change: number;
  long: SideSummary;
  short: SideSummary;
  /** Who holds it, biggest first. */
  holders: Holding[];
  /** Long and short value together, in USD. */
  notional: number;
  /** The long side's share of the value, 0 to 1. */
  bias: number;
  upnl: number;
}

function emptySide(): SideSummary {
  return { traders: 0, notional: 0, size: 0, entry: NaN, upnl: 0, leverage: NaN };
}

/** How a group of traders is positioned: one row per coin, with the long and the short side added up. A wallet
 *  listed twice counts once. */
export function positioning(holdings: readonly { trader: Trader; positions: readonly Position[] }[], markets: ReadonlyMap<string, Market> = new Map(), { minValue = 0 } = {}): CoinRow[] {
  const rows = new Map<string, CoinRow>();
  const sums = new Map<string, { long: { cost: number; levValue: number }; short: { cost: number; levValue: number } }>();
  const seen = new Set<string>();

  for (const { trader, positions } of holdings) {
    for (const position of positions) {
      if (!(position.size > 0) || !(position.value >= minValue)) continue;
      const key = `${position.coin}|${trader.wallet}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let row = rows.get(position.coin);
      if (!row) {
        const market = markets.get(position.coin);
        row = {
          coin: position.coin,
          mark: market?.mark ?? position.mark,
          change: market?.change ?? NaN,
          long: emptySide(),
          short: emptySide(),
          holders: [],
          notional: 0,
          bias: 0.5,
          upnl: 0,
        };
        rows.set(position.coin, row);
        sums.set(position.coin, { long: { cost: 0, levValue: 0 }, short: { cost: 0, levValue: 0 } });
      }
      const side = row[position.side];
      const sum = sums.get(position.coin)![position.side];
      side.traders++;
      side.notional += position.value;
      side.size += position.size;
      side.upnl += Number.isFinite(position.upnl) ? position.upnl : 0;
      sum.cost += position.entry * position.size;
      if (Number.isFinite(position.leverage)) sum.levValue += position.leverage * position.value;
      row.holders.push({ trader, position });
    }
  }

  for (const row of rows.values()) {
    const sum = sums.get(row.coin)!;
    for (const name of ["long", "short"] as const) {
      const side = row[name];
      side.entry = side.size > 0 ? sum[name].cost / side.size : NaN;
      side.leverage = side.notional > 0 ? sum[name].levValue / side.notional : NaN;
    }
    row.notional = row.long.notional + row.short.notional;
    row.bias = row.notional > 0 ? row.long.notional / row.notional : 0.5;
    row.upnl = row.long.upnl + row.short.upnl;
    row.holders.sort((a, b) => b.position.value - a.position.value);
  }
  return sortPositioning([...rows.values()], "traders");
}

export type PositionSort = "traders" | "notional" | "long" | "short" | "pnl";

export function sortPositioning(rows: CoinRow[], by: PositionSort): CoinRow[] {
  const key: Record<PositionSort, (row: CoinRow) => number> = {
    traders: (row) => row.holders.length * 1e15 + row.notional,
    notional: (row) => row.notional,
    // Most one-sided first, with size breaking ties so a lone small position doesn't lead.
    long: (row) => (row.long.notional - row.short.notional),
    short: (row) => (row.short.notional - row.long.notional),
    pnl: (row) => row.upnl,
  };
  return rows.sort((a, b) => key[by](b) - key[by](a));
}

export interface TrackRecord {
  /** Fills that realized a profit or loss. */
  closes: number;
  wins: number;
  losses: number;
  /** Wins over decided closes, 0 to 1; NaN with none. */
  winRate: number;
  /** Realized profit over the fills, before fees, in USD. */
  realized: number;
  fees: number;
  /** The oldest fill counted, in milliseconds. */
  since: number;
}

/** A wallet's record over the fills given: every fill that closed part of a position is a win or a loss by what it
 *  realized. Closes within a dollar of even count as neither. */
export function fillRecord(fills: readonly Fill[]): TrackRecord {
  let wins = 0;
  let losses = 0;
  let realized = 0;
  let fees = 0;
  let closes = 0;
  let since = Infinity;
  for (const fill of fills) {
    if (Number.isFinite(fill.fee)) fees += fill.fee;
    if (fill.time < since) since = fill.time;
    if (!Number.isFinite(fill.closedPnl) || fill.closedPnl === 0) continue;
    closes++;
    realized += fill.closedPnl;
    if (fill.closedPnl > 1) wins++;
    else if (fill.closedPnl < -1) losses++;
  }
  return { closes, wins, losses, winRate: wins + losses ? wins / (wins + losses) : NaN, realized, fees, since: Number.isFinite(since) ? since : NaN };
}

/** The page numbers a pager shows: all of them up to seven pages, otherwise the first, the last and the current
 *  one with its neighbours, with 0 where pages are skipped. */
export function pageList(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: Math.max(0, total) }, (_, index) => index + 1);
  const shown = new Set([1, total, current - 1, current, current + 1]);
  // Near either end, a few more pages keep the row the same length as it is in the middle.
  if (current <= 4) for (let page = 2; page <= 5; page++) shown.add(page);
  if (current >= total - 3) for (let page = total - 4; page < total; page++) shown.add(page);
  const out: number[] = [];
  for (const page of [...shown].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)) {
    if (out.length && page - out[out.length - 1] > 1) out.push(0);
    out.push(page);
  }
  return out;
}

/** An SVG path for a line through the points, scaled to fit the box, and the y of zero within it. */
export function sparkline(values: readonly number[], width: number, height: number, pad = 1): { line: string; area: string; zero: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return { line: "", area: "", zero: height / 2 };
  let min = Math.min(...finite, 0);
  let max = Math.max(...finite, 0);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const x = (index: number) => (index / (finite.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2);
  const points = finite.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const zero = y(0);
  return { line: `M${points.join("L")}`, area: `M0,${zero.toFixed(1)}L${points.join("L")}L${width},${zero.toFixed(1)}Z`, zero };
}
