import { test } from "node:test";
import assert from "node:assert/strict";
import {
  client,
  coinIcon,
  condenseBoard,
  displayName,
  fillRecord,
  formatAge,
  formatLeverage,
  formatPercent,
  formatPnl,
  formatPrice,
  formatSize,
  formatUsd,
  pageList,
  positioning,
  shortWallet,
  sortPositioning,
  tape,
  toAccount,
  toBoard,
  toFill,
  toMarkets,
  toPnl,
  toSpotPairs,
  toTrade,
} from "../dist/index.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

test("prices, sizes and leverage read the way traders write them", () => {
  assert.equal(formatPrice(80670.4), "80,670");
  assert.equal(formatPrice(3412.55), "3,412.6");
  assert.equal(formatPrice(123.456), "123.46");
  assert.equal(formatPrice(94.3199), "94.32");
  assert.equal(formatPrice(1.23456), "1.2346");
  assert.equal(formatPrice(0.42), "0.42");
  assert.equal(formatPrice(0.0004213), "0.0004213");
  assert.equal(formatPrice(NaN), "–");
  assert.equal(formatSize(106_000, "ETH"), "106K ETH");
  assert.equal(formatSize(2613.2), "2,613");
  assert.equal(formatSize(0.197), "0.197");
  assert.equal(formatLeverage(25), "25×");
  assert.equal(formatLeverage(4.73), "4.7×");
  assert.equal(formatLeverage(0), "–");
  assert.equal(formatUsd(745_000_000), "$745M");
  assert.equal(formatUsd(250_368_062), "$250M");
  assert.equal(formatUsd(100_000), "$100K");
  assert.equal(formatUsd(199_600_000), "$200M");
  assert.equal(formatUsd(999_600_000), "$1B");
  assert.equal(formatPnl(-120_000), "−$120K");
  assert.equal(formatPnl(-1_970_000), "−$1.97M");
  assert.equal(formatPercent(64.4, true), "+64%");
  assert.equal(formatAge(1_000_000 - 3000, 1_000_000), "3s");
  assert.equal(displayName("", "0x5b5d51203a0f9079f8aeb098a6523a13f298c060"), shortWallet("0x5b5d51203a0f9079f8aeb098a6523a13f298c060"));
});

const perf = (pnl, vlm = 1e6, roi = 0.1) => ({ pnl: String(pnl), roi: String(roi), vlm: String(vlm) });
const rawRow = (address, value, windows, name = null) => ({ ethAddress: address, accountValue: String(value), displayName: name, windowPerformances: Object.entries(windows) });

test("the board keeps traders, not holders, and ranks each window by profit", () => {
  const raw = {
    leaderboardRows: [
      rawRow(A.toUpperCase().replace("0X", "0x"), 1e6, { day: perf(10), week: perf(50), month: perf(300), allTime: perf(900) }, "Alpha"),
      rawRow(B, 5e9, { day: perf(9e7, 0), week: perf(1e8, 0), month: perf(2e8, 0), allTime: perf(3e8, 0) }),
      rawRow(C, 2e6, { day: perf(20), week: perf(40), month: perf(100), allTime: perf(1000) }),
      rawRow("not-an-address", 1e6, { month: perf(1e9) }),
    ],
  };
  const board = condenseBoard(raw, { size: 10 }, 42);
  assert.equal(board.updated, 42);
  // B never trades: its profit is the price of what it holds, and it stays off the board.
  assert.deepEqual(board.windows.month.map((trader) => trader.wallet), [A, C]);
  assert.deepEqual(board.windows.day.map((trader) => [trader.rank, trader.wallet]), [[1, C], [2, A]]);
  assert.equal(board.windows.month[0].name, "Alpha");
  assert.equal(board.windows.allTime[0].pnl, 1000);
  assert.equal(condenseBoard(raw, { size: 1 }).windows.week.length, 1);
});

test("an account's positions become longs and shorts with numbers", () => {
  const account = toAccount(A.toUpperCase().replace("0X", "0x"), {
    marginSummary: { accountValue: "143000000", totalMarginUsed: "142000000", totalNtlPos: "674000000" },
    withdrawable: "1000",
    assetPositions: [
      { position: { coin: "ETH", szi: "-106000.5", entryPx: "2322.7", positionValue: "248000000", unrealizedPnl: "-1970000", returnOnEquity: "-0.04", liquidationPx: "3699.5", marginUsed: "49600000", leverage: { type: "cross", value: 5 }, cumFunding: { sinceOpen: "-12000" } } },
      { position: { coin: "HYPE", szi: "1000", entryPx: "30", positionValue: "35000", unrealizedPnl: "5000", returnOnEquity: "1.2", liquidationPx: null, marginUsed: "3500", leverage: { type: "isolated", value: 10 } } },
      { position: { coin: "DOGE", szi: "0", entryPx: "0.1" } },
    ],
  });
  assert.equal(account.wallet, A);
  assert.equal(account.notional, 674_000_000);
  assert.deepEqual(account.positions.map((position) => [position.coin, position.side]), [["ETH", "short"], ["HYPE", "long"]]);
  const [eth, hype] = account.positions;
  assert.equal(eth.size, 106000.5);
  assert.ok(Math.abs(eth.mark - 248000000 / 106000.5) < 1e-9);
  assert.equal(eth.funding, -12000);
  assert.ok(Number.isNaN(hype.liquidation));
  assert.equal(hype.leverageType, "isolated");
});

test("markets, fills, trades and profit series map to plain records", () => {
  const markets = toMarkets([{ universe: [{ name: "BTC", maxLeverage: 40 }, { name: "OLD", isDelisted: true }, { name: "ETH", maxLeverage: 25 }] }, [{ markPx: "80000", prevDayPx: "78000", funding: "0.0000125", openInterest: "100", dayNtlVlm: "5000000000" }, {}, { markPx: "2341", prevDayPx: "2300", funding: "-0.00001", openInterest: "1000", dayNtlVlm: "2000000000" }]]);
  assert.deepEqual(markets.map((market) => market.coin), ["BTC", "ETH"]);
  assert.equal(markets[0].openInterest, 8_000_000);
  assert.ok(Math.abs(markets[1].change - (2341 / 2300 - 1)) < 1e-12);

  const fill = toFill({ coin: "BTC", px: "80000", sz: "0.5", side: "A", time: 1000, dir: "Close Long", closedPnl: "1200.5", hash: "0xh", tid: 7, fee: "12" });
  assert.equal(fill.side, "sell");
  assert.equal(fill.usd, 40000);
  assert.equal(fill.id, "0xh:7");

  const trade = toTrade({ coin: "ETH", side: "B", px: "2000", sz: "10", time: 5, hash: "0xt", tid: 1, users: [A.toUpperCase().replace("0X", "0x"), B] });
  assert.equal(trade.buyer, A);
  assert.equal(trade.seller, B);
  assert.equal(trade.usd, 20000);

  const series = [["month", { pnlHistory: [[1, "5"], [2, "9"]] }], ["perpMonth", { pnlHistory: [[1, "1"], [2, "3"]] }]];
  assert.deepEqual(toPnl(series, "month"), [{ time: 1, pnl: 1 }, { time: 2, pnl: 3 }], "the perp series, not the one with spot");
  assert.deepEqual(toPnl([["week", { pnlHistory: [[1, "4"]] }]], "week"), [{ time: 1, pnl: 4 }]);
});

const trader = (wallet, rank) => ({ rank, wallet, name: "", accountValue: 1e6, pnl: 1000, roi: 0.1, volume: 1e6 });
const position = (fields) => ({ wallet: A, coin: "ETH", side: "long", size: 10, entry: 2000, value: 21000, mark: 2100, upnl: 1000, roe: 0.1, liquidation: 1500, leverage: 10, leverageType: "cross", margin: 2100, funding: 0, ...fields });

test("positioning adds up each coin's longs and shorts", () => {
  const markets = new Map([["ETH", { coin: "ETH", mark: 2100, prevDay: 2000, change: 0.05, funding: 0, openInterest: 0, dayVolume: 0, maxLeverage: 25 }]]);
  const rows = positioning(
    [
      { trader: trader(A, 1), positions: [position({ size: 10, entry: 2000, value: 21000, leverage: 10 }), position({ coin: "BTC", side: "short", size: 1, entry: 80000, value: 80000, upnl: -500, leverage: 5 })] },
      { trader: trader(B, 2), positions: [position({ size: 30, entry: 2200, value: 63000, upnl: -3000, leverage: 20 })] },
      { trader: trader(C, 3), positions: [position({ side: "short", size: 20, entry: 2300, value: 42000, upnl: 4000, leverage: 5 }), position({ coin: "DUST", value: 50 })] },
      { trader: trader(A, 1), positions: [position({})] },
    ],
    markets,
    { minValue: 1000 },
  );
  assert.deepEqual(rows.map((row) => row.coin), ["ETH", "BTC"], "positions under the floor are left out");
  const eth = rows[0];
  assert.equal(eth.change, 0.05);
  assert.equal(eth.long.traders, 2, "a wallet listed twice counts once");
  assert.equal(eth.long.notional, 84000);
  assert.equal(eth.long.entry, (10 * 2000 + 30 * 2200) / 40);
  assert.equal(eth.long.leverage, (10 * 21000 + 20 * 63000) / 84000);
  assert.equal(eth.short.traders, 1);
  assert.equal(eth.short.entry, 2300);
  assert.equal(eth.notional, 126000);
  assert.equal(eth.bias, 84000 / 126000);
  assert.equal(eth.upnl, 2000);
  assert.equal(eth.holders[0].trader.wallet, B, "biggest holder first");
  assert.equal(rows[1].bias, 0);
  assert.deepEqual(sortPositioning(rows.slice(), "short").map((row) => row.coin), ["BTC", "ETH"]);
  assert.deepEqual(sortPositioning(rows.slice(), "long").map((row) => row.coin), ["ETH", "BTC"]);
  assert.deepEqual(sortPositioning(rows.slice(), "notional").map((row) => row.coin), ["ETH", "BTC"]);
  assert.deepEqual(sortPositioning(rows.slice(), "pnl").map((row) => row.coin), ["ETH", "BTC"]);
});

test("a record counts the fills that closed something", () => {
  const fill = (closedPnl, time, fee = 1) => ({ id: String(time), coin: "BTC", side: "sell", price: 1, size: 1, usd: 1, time, direction: "Close Long", closedPnl, fee });
  const record = fillRecord([fill(500, 3), fill(-200, 2), fill(0, 1), fill(0.5, 4), fill(NaN, 5)]);
  assert.equal(record.closes, 3);
  assert.equal(record.wins, 1);
  assert.equal(record.losses, 1);
  assert.equal(record.winRate, 0.5);
  assert.equal(record.realized, 300.5);
  assert.equal(record.fees, 5);
  assert.equal(record.since, 1);
  assert.ok(Number.isNaN(fillRecord([]).winRate));
});

test("pagers list every page up to seven, then the ends and the neighbours", () => {
  assert.deepEqual(pageList(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageList(1, 15), [1, 2, 3, 4, 5, 0, 15]);
  assert.deepEqual(pageList(8, 15), [1, 0, 7, 8, 9, 0, 15]);
});

test("the client posts info reads, caches them and waits out a 429", async () => {
  const calls = [];
  let attempts = 0;
  const fetch = async (url, init = {}) => {
    calls.push([url, init.method, init.body]);
    if (url.endsWith("/board.json")) return Response.json({ updated: 1, windows: { day: [], week: [], month: [{ rank: 1, wallet: A }], allTime: [] } });
    const body = JSON.parse(init.body);
    if (body.type === "clearinghouseState" && ++attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0.01" } });
    if (body.type === "clearinghouseState") return Response.json({ marginSummary: { accountValue: "10" }, assetPositions: [] });
    return Response.json([]);
  };
  const api = client({ fetch, board: "https://example.test/board.json", info: "https://info.test/info" });
  const [first, second] = await Promise.all([api.account(A), api.account(A)]);
  assert.equal(first.accountValue, 10);
  assert.deepEqual(first, second);
  assert.equal(calls.filter(([url]) => url === "https://info.test/info").length, 2, "one request, retried once after the 429");
  assert.deepEqual(JSON.parse(calls[0][2]), { type: "clearinghouseState", user: A });
  assert.equal(calls[0][1], "POST");
  await api.account(A);
  assert.equal(calls.length, 2, "served from the cache");
  const board = await api.board();
  assert.equal(board.windows.month[0].wallet, A);
});

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static last = null;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    }, 0);
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  push(data) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ channel: "trades", data }) }));
  }
}

test("the tape subscribes to its coins and hands on large trades once, in batches", async () => {
  const batches = [];
  const feed = tape({ coins: ["BTC", "ETH", "BTC"], minUsd: 10_000, WebSocket: FakeSocket, onTrades: (trades) => batches.push(trades.map((trade) => trade.id)) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const socket = FakeSocket.last;
  assert.deepEqual(socket.sent.map((message) => message.subscription.coin), ["BTC", "ETH"]);
  const row = (tid, sz, time) => ({ coin: "BTC", side: "B", px: "80000", sz, time, hash: "0xh", tid, users: [A, B] });
  socket.push([row(1, "0.5", 2), row(2, "0.01", 3), row(3, "1", 1)]);
  socket.push([row(1, "0.5", 2)]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(batches, [["0xh:3", "0xh:1"]], "oldest first, small and repeated trades dropped");
  feed.setCoins(["ETH", "SOL"]);
  assert.deepEqual(socket.sent.slice(2).map((message) => [message.method, message.subscription.coin]), [["unsubscribe", "BTC"], ["subscribe", "SOL"]]);
  feed.stop();
});

test("a board read from a server comes back with numbers, a missing one as NaN", () => {
  const board = toBoard({ updated: 5, windows: { month: [{ rank: 1, wallet: A.toUpperCase().replace("0X", "0x"), name: "x", accountValue: "10", pnl: 3, roi: null, volume: null }] } });
  assert.equal(board.updated, 5);
  assert.equal(board.windows.month[0].wallet, A);
  assert.equal(board.windows.month[0].accountValue, 10);
  assert.ok(Number.isNaN(board.windows.month[0].roi));
  assert.deepEqual(board.windows.day, []);
});

test("a coin's logo is the one Hyperliquid's app shows, by the coin's own name", () => {
  assert.equal(coinIcon("BTC"), "https://app.hyperliquid.xyz/coins/BTC.svg");
  assert.equal(coinIcon("kPEPE"), "https://app.hyperliquid.xyz/coins/PEPE.svg");
  assert.equal(coinIcon("kaito"), "https://app.hyperliquid.xyz/coins/kaito.svg");
});

test("spot pairs get their tokens' names, and Unit's tokens the logo of the coin they carry", () => {
  const pairs = toSpotPairs({
    tokens: [
      { name: "USDC", index: 0, fullName: null },
      { name: "PURR", index: 1, fullName: null },
      { name: "UBTC", index: 197, fullName: "Unit Bitcoin" },
    ],
    universe: [
      { name: "PURR/USDC", tokens: [1, 0], index: 0 },
      { name: "@142", tokens: [197, 0], index: 142 },
      { name: "@999", tokens: [404, 0], index: 999 },
    ],
  });
  assert.deepEqual([...pairs.keys()], ["PURR/USDC", "@142"]);
  assert.equal(pairs.get("@142").name, "UBTC/USDC");
  assert.equal(pairs.get("@142").icon, "https://app.hyperliquid.xyz/coins/BTC.svg");
  assert.equal(pairs.get("PURR/USDC").icon, "https://app.hyperliquid.xyz/coins/PURR_spot.svg");
});
