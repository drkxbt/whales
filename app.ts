import { client, coinIcon, isWallet, type Account, type Client, type ClientOptions, type Fill, type Market, type Position, type SpotPair, type Trade, type Trader } from "./api.js";
import { WINDOWS as WINDOW_KEYS, type Board, type Window } from "./board.js";
import { displayName, EMPTY, formatAge, formatLeverage, formatPercent, formatPnl, formatPrice, formatSize, formatUsd, shortWallet } from "./format.js";
import { fillRecord, pageList, positioning, sortPositioning, sparkline, type CoinRow, type PositionSort } from "./model.js";
import { tape, type Tape } from "./tape.js";
import { walletAvatar } from "./avatar.js";

export type View = "positions" | "tape" | "board";

/** Everything a person can change, as plain data: put it in the URL to make a view shareable. */
export interface WhalesState {
  view: View;
  window: Window;
  /** The wallet open in the dialog. */
  wallet: string | null;
  sort: PositionSort;
  /** The smallest trade on the tape, in USD. */
  minUsd: number;
  /** Show only trades by traders on the board. */
  topOnly: boolean;
}

export interface WhalesOptions extends ClientOptions {
  /** A client to share with the rest of the page; one is made from the other options otherwise. */
  api?: Client;
  state?: Partial<WhalesState>;
  /** How many of the board's top traders Positions reads. */
  depth?: number;
  /** How many of the busiest coins the tape listens to. */
  coins?: number;
  /** Listen for trades while the tape is showing. On by default. */
  live?: boolean;
  /** The websocket's address. */
  socket?: string;
  /** Each perp's logo address: Hyperliquid's own by default, or false to show the coin's first letter only. Spot
   *  pairs in a wallet's fills show Hyperliquid's logos unless this is false. */
  coinIcon?: ((coin: string) => string) | false;
  /** A WebSocket implementation for the tape, for runtimes without one or to replay a recording. */
  WebSocket?: typeof WebSocket;
  theme?: "light" | "dark" | "auto";
  onStateChange?: (state: WhalesState) => void;
}

export interface Whales {
  readonly state: WhalesState;
  setState(next: Partial<WhalesState>): void;
  openWallet(wallet: string): void;
  closeWallet(): void;
  destroy(): void;
}

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "positions", label: "Positions", hint: "How the top traders are positioned now" },
  { key: "tape", label: "Tape", hint: "Large trades as they happen" },
  { key: "board", label: "Board", hint: "The traders who made the most" },
];
const WINDOWS: { key: Window; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "allTime", label: "All time" },
];
const BOARD_PREFIX: Record<Window, string> = { day: "today's", week: "this week's", month: "this month's", allTime: "the all-time" };
const SORTS: { key: PositionSort; label: string; hint: string }[] = [
  { key: "traders", label: "Most traders", hint: "Held by the most top traders" },
  { key: "notional", label: "Most money", hint: "The most value, long and short together" },
  { key: "long", label: "Most long", hint: "The most value held long over short" },
  { key: "short", label: "Most short", hint: "The most value held short over long" },
  { key: "pnl", label: "Most in profit", hint: "The most open profit" },
];
const TAPE_SIZES = [10_000, 50_000, 100_000, 500_000, 1_000_000];
// Long lists show twenty at a time, with page numbers under them.
const PAGE = 20;
const TAPE_KEEP = 1000;

const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  out: '<path d="M14 5h5v5M19 5l-8 8M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  bellOn: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Z" fill="currentColor"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/>',
  top: '<path d="M12 3.5 14.4 9l5.9.5-4.5 3.9 1.4 5.8L12 16.1 6.8 19.2l1.4-5.8L3.7 9.5 9.6 9Z" fill="currentColor"/>',
};

export function whales(container: HTMLElement, options: WhalesOptions = {}): Whales {
  const api = options.api ?? client(options);
  const live = options.live ?? true;
  const depth = Math.max(5, Math.min(300, options.depth ?? 200));
  const coinCount = Math.max(1, Math.min(100, options.coins ?? 30));
  const iconFor = options.coinIcon === false ? () => "" : (options.coinIcon ?? coinIcon);
  const pairIcon = (pair: SpotPair) => (options.coinIcon === false ? "" : pair.icon);
  const state: WhalesState = {
    view: "positions",
    window: "month",
    wallet: null,
    sort: "traders",
    minUsd: 100_000,
    topOnly: false,
    ...clean(options.state ?? {}),
  };

  const root = element("div", "wh");
  if (options.theme && options.theme !== "light") root.dataset.theme = options.theme;
  container.replaceChildren(root);

  /* ---------- Chrome: views and window ---------- */

  const head = element("div", "wh-head");
  const tabs = element("div", "wh-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "View");
  const tabButtons = new Map<View, HTMLButtonElement>();
  const panels = new Map<View, HTMLElement>();
  const id = `wh-${Math.random().toString(36).slice(2, 8)}`;
  for (const view of VIEWS) {
    const button = element("button", "wh-tab", view.label);
    button.type = "button";
    button.id = `${id}-tab-${view.key}`;
    button.title = view.hint;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${id}-panel-${view.key}`);
    button.addEventListener("click", () => setState({ view: view.key }));
    tabButtons.set(view.key, button);
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    const order = VIEWS.map((view) => view.key);
    const index = order.indexOf(state.view);
    const next = event.key === "ArrowRight" ? order[(index + 1) % order.length] : event.key === "ArrowLeft" ? order[(index + order.length - 1) % order.length] : null;
    if (!next) return;
    event.preventDefault();
    setState({ view: next });
    tabButtons.get(next)?.focus();
  });
  const windowGroup = segmented("Window", WINDOWS, () => state.window, (key) => setState({ window: key }));
  head.append(tabs, windowGroup.element);

  for (const view of VIEWS) {
    const panel = element("section", "wh-panel");
    panel.id = `${id}-panel-${view.key}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `${id}-tab-${view.key}`);
    panel.dataset.panel = view.key;
    panels.set(view.key, panel);
  }
  root.append(head, ...panels.values());

  // The board and the markets are shared by every view; each is read once and refreshed when it gets old.
  let boardRead: { at: number; value: Promise<Board> } | null = null;
  let marketsRead: { at: number; value: Promise<Market[]> } | null = null;
  const readBoard = () => {
    if (!boardRead || Date.now() - boardRead.at > 120_000) {
      const value = api.board();
      boardRead = { at: Date.now(), value };
      value.catch(() => (boardRead = null));
    }
    return boardRead.value;
  };
  const readMarkets = () => {
    if (!marketsRead || Date.now() - marketsRead.at > 30_000) {
      const value = api.markets();
      marketsRead = { at: Date.now(), value };
      value.catch(() => (marketsRead = null));
    }
    return marketsRead.value;
  };
  let tops = new Map<string, Trader>();
  async function boardFor(window: Window): Promise<Trader[]> {
    const board = await readBoard();
    const traders = board.windows[window] ?? [];
    if (window === state.window) tops = new Map(traders.map((trader) => [trader.wallet, trader]));
    return traders;
  }
  /** "the top 1,000 of this month's board", once the board is in. */
  const boardTop = () => (tops.size ? `the top ${tops.size.toLocaleString("en-US")} of ${BOARD_PREFIX[state.window]} board` : `${BOARD_PREFIX[state.window]} board`);

  /* ---------- Positions ---------- */

  const positionsPanel = panels.get("positions")!;
  const positionsNote = element("p", "wh-note");
  const positionsTools = element("div", "wh-tools");
  const sortGroup = segmented("Sort", SORTS, () => state.sort, (key) => setState({ sort: key }));
  positionsTools.append(sortGroup.element);
  const progress = element("div", "wh-progress");
  progress.setAttribute("role", "status");
  const coinList = element("ol", "wh-coins");
  const coinPager = pager("Coin pages", () => {
    renderPositions();
    keepInView(coinList);
  });
  positionsPanel.append(positionsNote, positionsTools, progress, coinList, coinPager.element);
  let coinRows: CoinRow[] = [];
  let positionsLoad: AbortController | undefined;
  let positionsKey = "";
  const openCoins = new Set<string>();

  async function loadPositions() {
    const key = state.window;
    if (key === positionsKey && coinRows.length) return renderPositions();
    positionsLoad?.abort();
    const load = (positionsLoad = new AbortController());
    const signal = load.signal;
    busy(positionsPanel, true);
    coinRows = [];
    openCoins.clear();
    coinPager.reset();
    coinPager.update(0);
    coinList.replaceChildren(...Array.from({ length: 5 }, () => element("li", "wh-coin is-skeleton")));
    positionsNote.textContent = `Open perp positions of the top ${depth} traders by profit ${windowPhrase(state.window)}, added up by coin. Positions under $1,000 are left out.`;
    try {
      showProgress("Reading the board…", 0);
      const [traders, markets] = await Promise.all([boardFor(state.window), readMarkets()]);
      const top = traders.slice(0, depth);
      let done = 0;
      let missed = 0;
      const holdings = await Promise.all(
        top.map(async (trader) => {
          const account = await api.account(trader.wallet, { signal }).catch((error) => {
            if (signal.aborted) throw error;
            missed++;
            return null;
          });
          showProgress(`Reading positions: ${++done} of ${top.length} traders`, done / top.length);
          return { trader, positions: account?.positions ?? [] };
        }),
      );
      if (signal.aborted) return;
      // Hyperliquid answers each visitor's reads up to a limit a minute; past it, say how many are missing.
      if (missed) positionsNote.textContent += ` ${missed} of the ${top.length} couldn't be read just now, so they're missing; try again in a minute.`;
      coinRows = positioning(holdings, new Map(markets.map((market) => [market.coin, market])), { minValue: 1000 });
      positionsKey = missed ? "" : key;
      showProgress("", 1);
      renderPositions();
    } catch (error) {
      if (signal.aborted) return;
      showProgress("", 0);
      coinList.replaceChildren(stateItem(failure(error), () => {
        positionsKey = "";
        loadPositions();
      }));
    } finally {
      if (positionsLoad === load) busy(positionsPanel, false);
    }
  }

  function showProgress(text: string, share: number) {
    progress.textContent = text;
    progress.hidden = !text;
    progress.style.setProperty("--wh-progress", String(share));
  }

  function renderPositions() {
    if (!coinRows.length) {
      coinList.replaceChildren(stateItem("None of these traders holds an open position right now."));
      coinPager.update(0);
      return;
    }
    const rows = sortPositioning(coinRows.slice(), state.sort);
    coinPager.update(rows.length);
    coinList.replaceChildren(...rows.slice((coinPager.page - 1) * PAGE, coinPager.page * PAGE).map(coinItem));
  }

  function coinItem(row: CoinRow): HTMLLIElement {
    const item = element("li", "wh-coin");
    const summary = element("button", "wh-coin-head");
    summary.type = "button";
    summary.setAttribute("aria-expanded", String(openCoins.has(row.coin)));

    const name = element("span", "wh-coin-name");
    name.append(coinMark(row.coin, iconFor(row.coin)), element("span", "wh-coin-ticker", row.coin));
    const price = element("span", "wh-coin-price");
    price.append(element("span", "", formatPrice(row.mark)), element("span", `wh-change ${tone(row.change)}`, formatPercent(row.change * 100, true)));
    name.append(price);

    const bias = element("span", "wh-bias");
    const bar = element("span", "wh-bias-bar");
    const longPart = element("span", "wh-bias-long");
    longPart.style.width = `${Math.round(row.bias * 100)}%`;
    bar.append(longPart);
    const counts = element("span", "wh-bias-counts");
    counts.append(
      element("span", "wh-long-text", `${row.long.traders} long`),
      element("span", "wh-muted", " · "),
      element("span", "wh-short-text", `${row.short.traders} short`),
      element("span", "wh-muted", ` · ${formatPercent(row.bias * 100)} long`),
    );
    bias.append(bar, counts);

    const facts = element("span", "wh-facts");
    facts.append(
      fact("Long", formatUsd(row.long.notional), "is-long"),
      fact("Short", formatUsd(row.short.notional), "is-short"),
      fact("Long entry", formatPrice(row.long.entry)),
      fact("Short entry", formatPrice(row.short.entry)),
      fact("Open profit", formatPnl(row.upnl), tone(row.upnl)),
    );
    summary.append(name, bias, facts, icon(ICONS.chevron, "wh-chevron"));

    const detail = element("div", "wh-coin-detail");
    detail.hidden = !openCoins.has(row.coin);
    summary.addEventListener("click", () => {
      const open = !openCoins.has(row.coin);
      if (open) openCoins.add(row.coin);
      else openCoins.delete(row.coin);
      summary.setAttribute("aria-expanded", String(open));
      detail.hidden = !open;
    });

    const table = element("table", "wh-table wh-holders");
    const thead = element("thead", "");
    thead.append(tableRow([headCell("Trader", "wh-who"), headCell("Side", ""), headCell("Value", "wh-num"), headCell("Entry", "wh-num"), headCell("Liquidation", "wh-num wh-hide-sm"), headCell("Leverage", "wh-num wh-hide-sm"), headCell("Open profit", "wh-num")]));
    const tbody = element("tbody", "");
    const holderPager = pager("Holder pages", drawHolders);
    function drawHolders() {
      holderPager.update(row.holders.length);
      tbody.replaceChildren(
        ...row.holders.slice((holderPager.page - 1) * PAGE, holderPager.page * PAGE).map(({ trader, position }) => {
          const tr = element("tr", "wh-row");
          tr.append(
            traderCell(trader, () => openWallet(trader.wallet, summary)),
            sideCell(position),
            cell("wh-num", formatUsd(position.value)),
            cell("wh-num wh-muted", formatPrice(position.entry)),
            cell("wh-num wh-muted wh-hide-sm", formatPrice(position.liquidation)),
            cell("wh-num wh-muted wh-hide-sm", formatLeverage(position.leverage)),
            cell(`wh-num ${tone(position.upnl)}`, formatPnl(position.upnl)),
          );
          return tr;
        }),
      );
    }
    drawHolders();
    table.append(thead, tbody);
    detail.append(element("div", "wh-scroll", undefined, [table]), holderPager.element, externalLink(`https://app.hyperliquid.xyz/trade/${encodeURIComponent(row.coin)}`, `${row.coin} on Hyperliquid`));
    item.append(summary, detail);
    return item;
  }

  /* ---------- Tape ---------- */

  const tapePanel = panels.get("tape")!;
  const tapeTools = element("div", "wh-tools");
  const sizeLabel = element("label", "wh-field");
  const sizeSelect = element("select", "wh-select");
  for (const size of TAPE_SIZES) {
    const option = element("option", "", `${formatUsd(size)}+`);
    option.value = String(size);
    sizeSelect.append(option);
  }
  sizeSelect.addEventListener("change", () => setState({ minUsd: Number(sizeSelect.value) }));
  sizeLabel.append(element("span", "wh-field-label", "Size"), sizeSelect);
  const onlyLabel = element("label", "wh-switch");
  const onlyInput = element("input", "");
  onlyInput.type = "checkbox";
  onlyInput.setAttribute("role", "switch");
  onlyInput.addEventListener("change", () => setState({ topOnly: onlyInput.checked }));
  onlyLabel.append(onlyInput, element("span", "wh-switch-track"), element("span", "wh-field-label", "Top traders only"));
  const notifyButton = iconButton("wh-icon-button", "Notify me when a top trader makes a large trade", ICONS.bell);
  notifyButton.setAttribute("aria-pressed", "false");
  notifyButton.hidden = typeof Notification === "undefined";
  const liveDot = element("span", "wh-live", "Live");
  liveDot.title = "Trades arrive as they happen";
  tapeTools.append(sizeLabel, onlyLabel, element("span", "wh-grow"), liveDot, notifyButton);
  const tapeNote = element("p", "wh-note");
  const tapeTable = element("table", "wh-table wh-tape");
  const tapeHead = element("thead", "");
  tapeHead.append(tableRow([headCell("When", "wh-when"), headCell("Trader", "wh-who"), headCell("Trade", "wh-what"), headCell("Price", "wh-num wh-hide-sm"), headCell("Size", "wh-num")]));
  const tapeBody = element("tbody", "");
  tapeTable.append(tapeHead, tapeBody);
  const tapeScroll = element("div", "wh-scroll", undefined, [tapeTable]);
  const tapePager = pager("Tape pages", () => {
    renderTape();
    keepInView(tapeScroll);
  });
  tapePanel.append(tapeTools, tapeNote, tapeScroll, tapePager.element);

  let tapeFeed: Tape | undefined;
  let tapeCoins: string[] = [];
  let trades: Trade[] = [];
  let notify = false;
  let tapeStatus: "connecting" | "live" | "closed" = "connecting";
  const clock = setInterval(() => {
    for (const time of root.querySelectorAll<HTMLElement>("[data-time]")) time.textContent = formatAge(Number(time.dataset.time));
  }, 5000);

  async function runTape() {
    const wanted = live && (state.view === "tape" || notify);
    if (wanted && !tapeFeed) {
      // The busiest coins carry almost all of the large trades.
      const markets = await readMarkets().catch(() => [] as Market[]);
      if (tapeFeed || !(live && (state.view === "tape" || notify))) return;
      tapeCoins = markets.slice().sort((a, b) => b.dayVolume - a.dayVolume).slice(0, coinCount).map((market) => market.coin);
      if (!tapeCoins.length) tapeCoins = ["BTC", "ETH", "SOL", "HYPE"];
      tapeFeed = tape({
        coins: tapeCoins,
        minUsd: Math.min(...TAPE_SIZES),
        url: options.socket,
        WebSocket: options.WebSocket,
        onTrades(fresh) {
          // A new subscription starts with a snapshot of trades already made; those already listed stay once.
          const known = new Set(trades.map((trade) => trade.id));
          const added = fresh.filter((trade) => !known.has(trade.id));
          if (!added.length) return;
          // A few new trades flash as they land; a burst, like the snapshot that opens the tape, just appears.
          const flash = trades.length > 0 && added.length <= 8;
          trades = [...added.reverse(), ...trades].slice(0, TAPE_KEEP);
          notifyAbout(added);
          renderTape(flash ? new Set(added.map((trade) => trade.id)) : undefined);
        },
        onStatus(status) {
          tapeStatus = status;
          liveDot.classList.toggle("is-stale", status !== "live");
          if (!trades.length) renderTape();
        },
      });
      boardFor(state.window).then(() => renderTape()).catch(() => {});
      renderTape();
    } else if (!wanted && tapeFeed) {
      // The tape is what happened while it was open: coming back starts it over rather than leaving a gap.
      tapeFeed.stop();
      tapeFeed = undefined;
      trades = [];
      tapePager.reset();
    }
  }

  // The trader a trade is shown under: one on the board if either side is, otherwise whoever took the trade.
  function traderOf(trade: Trade): { wallet: string; side: "buy" | "sell" } {
    const buyerTop = tops.has(trade.buyer);
    const sellerTop = tops.has(trade.seller);
    if (buyerTop && !sellerTop) return { wallet: trade.buyer, side: "buy" };
    if (sellerTop && !buyerTop) return { wallet: trade.seller, side: "sell" };
    return trade.side === "buy" ? { wallet: trade.buyer, side: "buy" } : { wallet: trade.seller, side: "sell" };
  }

  function renderTape(fresh = new Set<string>()) {
    const matching = trades.filter((trade) => trade.usd >= state.minUsd && (!state.topOnly || tops.has(trade.buyer) || tops.has(trade.seller)));
    tapePager.update(matching.length);
    const shown = matching.slice((tapePager.page - 1) * PAGE, tapePager.page * PAGE);
    tapeNote.textContent = `Every trade of ${formatUsd(state.minUsd)} or more on the ${tapeCoins.length || coinCount} busiest coins, as it happens${state.topOnly ? `, by traders in ${boardTop()}.` : `. A star marks a trader in ${boardTop()}.`}`;
    if (!shown.length) {
      tapeBody.replaceChildren(stateRow(5, tapeStatus === "live" ? "No trades this size yet. They show up here as they happen." : tapeStatus === "closed" ? "The connection dropped. Reconnecting…" : "Connecting to Hyperliquid…"));
      return;
    }
    tapeBody.replaceChildren(
      ...shown.map((trade) => {
        const tr = element("tr", `wh-row${fresh.has(trade.id) ? " is-new" : ""}`);
        const when = cell("wh-when wh-muted", formatAge(trade.time));
        when.dataset.time = String(trade.time);
        const who = traderOf(trade);
        const top = tops.get(who.wallet);
        const traderCellEl = traderCell(top ?? blankTrader(who.wallet), () => openWallet(who.wallet, tr), Boolean(top));
        const what = element("td", "wh-what");
        what.append(element("span", `wh-side ${who.side === "buy" ? "is-buy" : "is-sell"}`, who.side === "buy" ? "Bought" : "Sold"), coinChip(trade.coin, iconFor(trade.coin)), element("span", "wh-muted", formatSize(trade.size)));
        tr.append(when, traderCellEl, what, cell("wh-num wh-muted wh-hide-sm", formatPrice(trade.price)), cell("wh-num wh-strong", formatUsd(trade.usd)));
        return tr;
      }),
    );
  }

  function notifyAbout(fresh: Trade[]) {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const trade of fresh) {
      if (trade.usd < state.minUsd) continue;
      const who = traderOf(trade);
      const top = tops.get(who.wallet);
      if (!top) continue;
      new Notification(`${displayName(top.name, top.wallet)} ${who.side === "buy" ? "bought" : "sold"} ${formatUsd(trade.usd)} of ${trade.coin}`, {
        body: `At ${formatPrice(trade.price)}. Number ${top.rank} on ${BOARD_PREFIX[state.window]} board.`,
        tag: trade.id,
      });
    }
  }

  notifyButton.addEventListener("click", async () => {
    if (!notify && Notification.permission !== "granted") {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") return;
    }
    notify = !notify;
    notifyButton.setAttribute("aria-pressed", String(notify));
    notifyButton.replaceChildren(icon(notify ? ICONS.bellOn : ICONS.bell));
    const label = notify ? "Stop notifications" : "Notify me when a top trader makes a large trade";
    notifyButton.setAttribute("aria-label", label);
    notifyButton.title = label;
    runTape();
  });

  /* ---------- Board ---------- */

  const boardPanel = panels.get("board")!;
  const boardNote = element("p", "wh-note");
  const boardTable = element("table", "wh-table wh-board");
  const boardCaption = element("caption", "wh-sr");
  const boardHead = element("thead", "");
  boardHead.append(tableRow([headCell("#", "wh-rank"), headCell("Trader", "wh-who"), headCell("Profit", "wh-num"), headCell("Return", "wh-num"), headCell("Account", "wh-num wh-hide-sm", "USD in the account now"), headCell("Volume", "wh-num wh-hide-sm", "USD traded in the window")]));
  const boardBody = element("tbody", "");
  boardTable.append(boardCaption, boardHead, boardBody);
  const boardScroll = element("div", "wh-scroll", undefined, [boardTable]);
  const boardPager = pager("Board pages", () => {
    renderBoard();
    keepInView(boardScroll);
  });
  boardPanel.append(boardNote, boardScroll, boardPager.element);
  let board: Trader[] = [];
  let boardUpdated = NaN;
  let boardLoad: AbortController | undefined;

  async function loadBoard() {
    boardLoad?.abort();
    const load = (boardLoad = new AbortController());
    busy(boardPanel, true);
    if (!board.length) boardBody.replaceChildren(...skeletonRows(8, 6));
    try {
      const traders = await boardFor(state.window);
      boardUpdated = (await readBoard()).updated;
      if (load.signal.aborted) return;
      board = traders;
      renderBoard();
    } catch (error) {
      if (load.signal.aborted) return;
      boardBody.replaceChildren(stateRow(6, failure(error), loadBoard));
    } finally {
      if (boardLoad === load) busy(boardPanel, false);
    }
  }

  function renderBoard() {
    boardCaption.textContent = `Top traders by profit, ${windowPhrase(state.window)}`;
    boardNote.textContent = `Ranked by profit ${windowPhrase(state.window)}${Number.isFinite(boardUpdated) ? `, as of ${formatAge(boardUpdated)} ago` : ""}. Accounts that trade less than $100K a month are left out: they mostly hold spot, and their profit is its price.`;
    if (!board.length) {
      boardBody.replaceChildren(stateRow(6, "Nobody on this board yet."));
      boardPager.update(0);
      return;
    }
    boardPager.update(board.length);
    boardBody.replaceChildren(
      ...board.slice((boardPager.page - 1) * PAGE, boardPager.page * PAGE).map((trader) => {
        const tr = element("tr", "wh-row");
        tr.append(
          cell("wh-rank", String(trader.rank)),
          traderCell(trader, () => openWallet(trader.wallet, tr)),
          cell(`wh-num ${tone(trader.pnl)}`, formatPnl(trader.pnl)),
          cell(`wh-num ${tone(trader.roi)}`, formatPercent(trader.roi * 100, true)),
          cell("wh-num wh-muted wh-hide-sm", formatUsd(trader.accountValue)),
          cell("wh-num wh-muted wh-hide-sm", formatUsd(trader.volume)),
        );
        tr.addEventListener("click", (event) => {
          if ((event.target as Element).closest("a, button")) return;
          openWallet(trader.wallet, tr);
        });
        return tr;
      }),
    );
  }

  /* ---------- Wallet ---------- */

  // A modal dialog sits in the top layer, so it covers the screen even when a parent of the app is transformed,
  // and it keeps focus inside without help.
  const dialog = element("dialog", "wh-wallet");
  const sheet = element("div", "wh-wallet-inner");
  dialog.append(sheet);
  root.append(dialog);
  // A click on the dimmed page lands on the dialog itself, outside its content.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) setState({ wallet: null });
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    setState({ wallet: null });
  });

  // On a phone the wallet is a sheet: pull it down by its top to close it.
  const narrow = typeof matchMedia === "undefined" ? null : matchMedia("(max-width: 560px)");
  let drag: { y: number; t: number; dy: number } | null = null;
  sheet.addEventListener("pointerdown", (event) => {
    const target = event.target as Element;
    if (!narrow?.matches || !target.closest(".wh-wallet-head, .wh-grab") || target.closest("a, button")) return;
    drag = { y: event.clientY, t: performance.now(), dy: 0 };
    try {
      sheet.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone can't be captured; the drag still follows it while it lasts.
    }
    dialog.style.transition = "none";
  });
  sheet.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dy = event.clientY - drag.y;
    // A pull upward gives a little and stops; a pull down follows the finger.
    drag.dy = dy > 0 ? dy : dy / 6;
    dialog.style.transform = `translateY(${drag.dy}px)`;
  });
  const release = () => {
    if (!drag) return;
    const { dy, t } = drag;
    drag = null;
    dialog.style.transition = "";
    dialog.style.transform = "";
    if (dy > dialog.offsetHeight * 0.25 || dy / Math.max(1, performance.now() - t) > 0.5) setState({ wallet: null });
  };
  sheet.addEventListener("pointerup", release);
  sheet.addEventListener("pointercancel", release);

  let walletLoad: AbortController | undefined;
  let opener: HTMLElement | null = null;
  let shownWallet: string | null = null;

  function openWallet(wallet: string, from?: HTMLElement) {
    opener = from ?? (document.activeElement as HTMLElement | null);
    setState({ wallet });
  }

  function showWallet(wallet: string | null) {
    if (wallet === shownWallet) return;
    shownWallet = wallet;
    walletLoad?.abort();
    if (!wallet) {
      if (dialog.open) dialog.close();
      opener?.focus({ preventScroll: true });
      opener = null;
      return;
    }
    const load = (walletLoad = new AbortController());
    const signal = load.signal;
    const known = tops.get(wallet);

    const close = iconButton("wh-icon-button wh-close", "Close", ICONS.close);
    close.addEventListener("click", () => setState({ wallet: null }));
    const name = element("h2", "wh-wallet-name", known ? displayName(known.name, wallet) : shortWallet(wallet));
    dialog.setAttribute("aria-label", `Trader ${name.textContent}`);
    const place = element("p", "wh-place", known ? `Number ${known.rank} on ${BOARD_PREFIX[state.window]} board, ${formatPnl(known.pnl)}` : "");
    const address = element("div", "wh-wallet-id");
    const copy = iconButton("wh-icon-button wh-copy", "Copy the wallet address", ICONS.copy);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(wallet);
        copy.replaceChildren(icon(ICONS.check));
        setTimeout(() => copy.replaceChildren(icon(ICONS.copy)), 1400);
      } catch {
        // Clipboard access can be refused; the address is on screen to select by hand.
      }
    });
    address.append(element("code", "wh-address", shortWallet(wallet)), copy);
    const links = element("div", "wh-wallet-links");
    links.append(externalLink(`https://app.hyperliquid.xyz/explorer/address/${wallet}`, "Hyperliquid explorer"));
    const top = element("header", "wh-wallet-head");
    top.append(avatar(wallet, "is-large"), element("div", "wh-wallet-title", undefined, [name, place, address, links]), close);
    if (!known) {
      // A wallet opened from a link can come before the board does, or sit further down it than the board holds.
      boardFor(state.window)
        .then(() => {
          if (signal.aborted) return;
          const ranked = tops.get(wallet);
          if (ranked) name.textContent = displayName(ranked.name, wallet);
          place.textContent = ranked ? `Number ${ranked.rank} on ${BOARD_PREFIX[state.window]} board, ${formatPnl(ranked.pnl)}` : `Not in ${boardTop()}`;
        })
        .catch(() => {});
    }

    const stats = element("dl", "wh-stats");
    const chart = element("div", "wh-chart");
    const positions = element("div", "wh-section");
    const record = element("div", "wh-section");
    const history = element("div", "wh-section");
    stats.append(...["Account value", "In positions", "Leverage", "Margin used"].map((label) => statItem(label, "")));
    for (const section of [positions, record, history]) section.append(element("div", "wh-skeleton-block"));
    const body = element("div", "wh-wallet-body", undefined, [stats, chart, positions, record, history]);
    const grab = element("span", "wh-grab");
    grab.setAttribute("aria-hidden", "true");
    sheet.replaceChildren(grab, top, body);
    body.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    close.focus({ preventScroll: true });

    api
      .account(wallet, { signal })
      .then((account) => {
        if (signal.aborted) return;
        drawAccount(account, stats, positions);
      })
      .catch(() => {
        stats.replaceChildren(element("p", "wh-note", "Couldn't load this account."));
        positions.replaceChildren(sectionHead("Open positions", ""), element("p", "wh-note", "Couldn't load positions."));
      });

    api
      .pnl(wallet, { window: "month", signal })
      .then((points) => {
        if (signal.aborted) return;
        const values = points.map((point) => point.pnl);
        const change = values.length > 1 ? values[values.length - 1] - values[0] : NaN;
        chart.replaceChildren(
          element("div", "wh-chart-head", undefined, [element("span", "wh-label", "Profit on perps, last 30 days"), element("span", `wh-chart-change ${tone(change)}`, formatPnl(change))]),
          spark(values.map((value) => value - (values[0] ?? 0)), 360, 72, "wh-spark-large"),
        );
      })
      .catch(() => chart.replaceChildren());

    api
      .fills(wallet, { signal })
      .then(async (fills) => {
        // Spot fills name their pair by an index ("@107"), so the pairs are read only for wallets that trade spot.
        const spot = fills.some((fill) => fill.coin.startsWith("@") || fill.coin.includes("/"))
          ? await api.spotPairs({ signal }).catch(() => new Map<string, SpotPair>())
          : new Map<string, SpotPair>();
        if (signal.aborted) return;
        drawRecord(fills, record);
        drawFills(fills, history, spot);
      })
      .catch(() => {
        record.replaceChildren(sectionHead("Record", ""), element("p", "wh-note", "Couldn't load the record."));
        history.replaceChildren(sectionHead("Fills", ""), element("p", "wh-note", "Couldn't load fills."));
      });
  }

  function drawAccount(account: Account, stats: HTMLElement, box: HTMLElement) {
    const leverage = account.accountValue > 0 ? account.notional / account.accountValue : NaN;
    stats.replaceChildren(
      statItem("Account value", formatUsd(account.accountValue)),
      statItem("In positions", formatUsd(account.notional)),
      statItem("Leverage", formatLeverage(leverage)),
      statItem("Margin used", formatUsd(account.marginUsed)),
    );
    const list = element("ul", "wh-positions");
    const positionPager = pager("Position pages", () => {
      draw();
      keepInView(list);
    });
    function draw() {
      positionPager.update(account.positions.length);
      list.replaceChildren(...account.positions.slice((positionPager.page - 1) * PAGE, positionPager.page * PAGE).map(positionItem));
    }
    draw();
    const total = account.positions.reduce((sum, position) => sum + (Number.isFinite(position.upnl) ? position.upnl : 0), 0);
    box.replaceChildren(
      sectionHead("Open positions", account.positions.length ? `${account.positions.length}, ${formatPnl(total)} open` : ""),
      account.positions.length ? list : element("p", "wh-note", "Nothing open right now."),
      positionPager.element,
    );
  }

  function positionItem(position: Position): HTMLLIElement {
    const li = element("li", "wh-position");
    const topLine = element("div", "wh-position-top");
    topLine.append(coinMark(position.coin, iconFor(position.coin)), element("span", "wh-position-coin", position.coin), sideChip(position), element("span", "wh-muted", `${formatLeverage(position.leverage)} ${position.leverageType}`));
    const facts = element("div", "wh-position-facts");
    facts.append(
      element("span", "wh-muted", `${formatSize(position.size, position.coin)} · ${formatPrice(position.entry)} → ${formatPrice(position.mark)}`),
      element("span", "wh-grow"),
      element("span", "wh-num", formatUsd(position.value)),
      element("span", `wh-num ${tone(position.upnl)}`, formatPnl(position.upnl)),
    );
    li.append(topLine, facts);
    if (Number.isFinite(position.liquidation)) li.append(element("div", "wh-position-liq wh-muted", `Liquidation at ${formatPrice(position.liquidation)}`));
    return li;
  }

  function drawRecord(fills: Fill[], box: HTMLElement) {
    const result = fillRecord(fills);
    const list = element("dl", "wh-stats wh-stats-small");
    list.append(
      statItem("Won", Number.isFinite(result.winRate) ? formatPercent(result.winRate * 100) : EMPTY),
      statItem("Wins / losses", `${result.wins} / ${result.losses}`),
      statItem("Realized", formatPnl(result.realized), tone(result.realized)),
    );
    const since = Number.isFinite(result.since) ? `${fills.length.toLocaleString("en-US")} fills over ${formatAge(result.since)}` : "";
    box.replaceChildren(sectionHead("Record", since), result.closes ? list : element("p", "wh-note", "No closed trades in the latest fills."), element("p", "wh-note", `Fees paid in these fills: ${formatUsd(result.fees)}.`));
  }

  function drawFills(fills: Fill[], box: HTMLElement, spot: Map<string, SpotPair>) {
    const list = element("ul", "wh-fills");
    const fillPager = pager("Fill pages", () => {
      draw();
      keepInView(list);
    });
    function draw() {
      fillPager.update(fills.length);
      list.replaceChildren(...fills.slice((fillPager.page - 1) * PAGE, fillPager.page * PAGE).map((fill) => fillItem(fill, spot.get(fill.coin))));
    }
    draw();
    box.replaceChildren(sectionHead("Fills", fills.length ? `latest ${fills.length.toLocaleString("en-US")}` : ""), fills.length ? list : element("p", "wh-note", "No fills yet."), fillPager.element);
  }

  function fillItem(fill: Fill, pair?: SpotPair): HTMLLIElement {
    const li = element("li", "wh-fill");
    const coin = pair?.name ?? fill.coin;
    const opening = /^open/i.test(fill.direction);
    li.append(
      element("span", `wh-side ${fill.side === "buy" ? "is-buy" : "is-sell"}`, fill.direction || (fill.side === "buy" ? "Buy" : "Sell")),
      element("span", "wh-fill-text", undefined, [coinMark(coin, pair ? pairIcon(pair) : iconFor(fill.coin), "is-small"), document.createTextNode(`${coin} · ${formatSize(fill.size)} at ${formatPrice(fill.price)}`)]),
      element("span", "wh-num", formatUsd(fill.usd)),
      element("span", `wh-num ${opening || !fill.closedPnl ? "wh-muted" : tone(fill.closedPnl)}`, opening || !fill.closedPnl ? formatAge(fill.time) : `${formatPnl(fill.closedPnl)} · ${formatAge(fill.time)}`),
    );
    return li;
  }

  /* ---------- State ---------- */

  function setState(next: Partial<WhalesState>) {
    const before = { ...state };
    Object.assign(state, clean(next));
    apply(before);
    options.onStateChange?.({ ...state });
  }

  function apply(before: WhalesState | null) {
    for (const [key, button] of tabButtons) {
      const selected = key === state.view;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const [key, section] of panels) section.hidden = key !== state.view;
    root.dataset.view = state.view;
    windowGroup.sync();
    sortGroup.sync();
    sizeSelect.value = String(TAPE_SIZES.includes(state.minUsd) ? state.minUsd : 100_000);
    onlyInput.checked = state.topOnly;

    const windowChanged = !before || before.window !== state.window;
    if (windowChanged) {
      board = [];
      boardPager.reset();
      boardFor(state.window).catch(() => {});
    }
    if (before && before.sort !== state.sort) coinPager.reset();
    if (!before || windowChanged || before.minUsd !== state.minUsd || before.topOnly !== state.topOnly) tapePager.reset();

    if (state.view === "positions" && (windowChanged || before?.view !== "positions" || before?.sort !== state.sort)) loadPositions();
    if (state.view === "board" && (windowChanged || before?.view !== "board")) loadBoard();
    if (state.view === "tape" && before && (windowChanged || before.minUsd !== state.minUsd || before.topOnly !== state.topOnly || before.view !== "tape")) renderTape();
    runTape();
    showWallet(state.wallet);
  }

  /* ---------- Small builders that need the closure ---------- */

  function traderCell(trader: Trader, onOpen: () => void, star = false): HTMLTableCellElement {
    const td = element("td", "wh-who");
    const button = element("button", "wh-trader");
    button.type = "button";
    button.append(avatar(trader.wallet), element("span", "wh-trader-name", displayName(trader.name, trader.wallet)));
    if (star) {
      button.append(icon(ICONS.top, "wh-star"), element("span", "wh-sr", `, number ${trader.rank} on the board`));
      button.title = `Number ${trader.rank} on ${BOARD_PREFIX[state.window]} board`;
    }
    button.addEventListener("click", onOpen);
    td.append(button);
    return td;
  }

  apply(null);
  options.onStateChange?.({ ...state });

  return {
    get state() {
      return { ...state };
    },
    setState,
    openWallet(wallet) {
      if (isWallet(wallet)) openWallet(wallet.toLowerCase());
    },
    closeWallet() {
      setState({ wallet: null });
    },
    destroy() {
      positionsLoad?.abort();
      boardLoad?.abort();
      walletLoad?.abort();
      tapeFeed?.stop();
      clearInterval(clock);
      root.remove();
    },
  };
}

/* ---------- Pure helpers ---------- */

function clean(next: Partial<WhalesState>): Partial<WhalesState> {
  const out: Partial<WhalesState> = {};
  if (next.view && VIEWS.some((view) => view.key === next.view)) out.view = next.view;
  if (next.window && (WINDOW_KEYS as readonly string[]).includes(next.window)) out.window = next.window;
  if (next.sort && SORTS.some((item) => item.key === next.sort)) out.sort = next.sort;
  if (typeof next.minUsd === "number" && next.minUsd >= 0) out.minUsd = next.minUsd;
  if (typeof next.topOnly === "boolean") out.topOnly = next.topOnly;
  if (next.wallet === null) out.wallet = null;
  else if (typeof next.wallet === "string" && isWallet(next.wallet)) out.wallet = next.wallet.toLowerCase();
  return out;
}

function windowPhrase(window: Window): string {
  return { day: "today", week: "this week", month: "this month", allTime: "since they joined" }[window];
}

function blankTrader(wallet: string): Trader {
  return { rank: NaN, wallet, name: "", accountValue: NaN, pnl: NaN, roi: NaN, volume: NaN };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, children?: Node[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (children) node.append(...children);
  return node;
}

function icon(paths: string, className = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `wh-svg ${className}`.trim());
  svg.innerHTML = paths;
  return svg;
}

function iconButton(className: string, label: string, paths: string): HTMLButtonElement {
  const button = element("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(paths));
  return button;
}

function segmented<K extends string>(label: string, items: { key: K; label: string; hint?: string }[], current: () => K, pick: (key: K) => void) {
  const group = element("div", "wh-segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  const buttons = items.map((item) => {
    const button = element("button", "wh-segment", item.label);
    button.type = "button";
    if (item.hint) button.title = item.hint;
    button.addEventListener("click", () => pick(item.key));
    group.append(button);
    return [item.key, button] as const;
  });
  return {
    element: group,
    sync() {
      for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === current()));
    },
  };
}

function tableRow(cells: HTMLElement[]): HTMLTableRowElement {
  const tr = element("tr", "");
  tr.append(...cells);
  return tr;
}

function headCell(text: string, className: string, hint = ""): HTMLTableCellElement {
  const th = element("th", className, text);
  th.scope = "col";
  if (hint) th.title = hint;
  return th;
}

function cell(className: string, text: string): HTMLTableCellElement {
  return element("td", className, text);
}

function sideCell(position: Position): HTMLTableCellElement {
  const td = element("td", "");
  td.append(sideChip(position));
  return td;
}

function sideChip(position: { side: "long" | "short" }): HTMLElement {
  return element("span", `wh-chip ${position.side === "long" ? "is-long" : "is-short"}`, position.side === "long" ? "Long" : "Short");
}

function coinChip(coin: string, logo: string): HTMLElement {
  return element("span", "wh-chip", undefined, [coinMark(coin, logo, "is-small"), document.createTextNode(coin)]);
}

/** The coin's first letter on a tile, covered by its logo once that loads. */
function coinMark(coin: string, src: string, extra = ""): HTMLElement {
  const mark = element("span", `wh-coin-mark ${extra}`.trim(), coin.replace(/^k(?=[A-Z])/, "").slice(0, 1));
  mark.setAttribute("aria-hidden", "true");
  mark.style.setProperty("--wh-hue", String(hue(coin)));
  const logo = coinLogo(src, () => mark.classList.add("has-logo"));
  if (logo) mark.append(logo);
  return mark;
}

// Lists redraw often; remembering which logos loaded keeps a known one from flashing its letter first, and
// remembering which failed keeps a coin without one from asking again.
const loadedLogos = new Set<string>();
const missingLogos = new Set<string>();

function coinLogo(src: string, onLoad: () => void): HTMLImageElement | null {
  if (!src || missingLogos.has(src)) return null;
  const img = element("img", "wh-logo");
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  const shown = () => {
    img.classList.add("is-loaded");
    onLoad();
  };
  img.addEventListener("load", () => {
    loadedLogos.add(src);
    shown();
  }, { once: true });
  img.addEventListener("error", () => {
    missingLogos.add(src);
    img.remove();
  }, { once: true });
  if (loadedLogos.has(src)) shown();
  img.src = src;
  return img;
}

function avatar(wallet: string, extra = ""): HTMLElement {
  const disc = element("span", `wh-avatar ${extra}`.trim());
  disc.setAttribute("aria-hidden", "true");
  disc.append(walletAvatar(wallet));
  return disc;
}

function stateRow(span: number, text: string, retry?: () => void): HTMLTableRowElement {
  const tr = element("tr", "wh-state-row");
  const td = element("td", "wh-state");
  td.colSpan = span;
  td.append(element("span", "", text));
  if (retry) td.append(retryButton(retry));
  tr.append(td);
  return tr;
}

function stateItem(text: string, retry?: () => void): HTMLLIElement {
  const li = element("li", "wh-state");
  li.append(element("span", "", text));
  if (retry) li.append(retryButton(retry));
  return li;
}

function retryButton(retry: () => void): HTMLButtonElement {
  const button = iconButton("wh-icon-button", "Try again", ICONS.retry);
  button.addEventListener("click", retry);
  return button;
}

function skeletonRows(count: number, span: number): HTMLTableRowElement[] {
  return Array.from({ length: count }, () => {
    const tr = element("tr", "wh-skeleton-row");
    const td = element("td", "");
    td.colSpan = span;
    td.append(element("span", "wh-skeleton"));
    tr.append(td);
    return tr;
  });
}

function busy(panel: HTMLElement, on: boolean) {
  panel.setAttribute("aria-busy", String(on));
}

function failure(error: unknown): string {
  if (error instanceof TypeError) return "Couldn't reach Hyperliquid. Check the connection and try again.";
  const status = (error as { status?: number })?.status;
  if (status === 429) return "Hyperliquid is asking for a pause. Try again in a minute.";
  return "Hyperliquid didn't answer as expected. Try again.";
}

function fact(label: string, value: string, extra = ""): HTMLElement {
  const box = element("span", `wh-fact ${extra}`.trim());
  box.append(element("span", "wh-label", label), element("span", "wh-value", value));
  return box;
}

function statItem(label: string, value: string, extra = ""): HTMLElement {
  const box = element("div", "wh-stat");
  box.append(element("dt", "wh-label", label), element("dd", `wh-value ${extra}`.trim(), value));
  return box;
}

function sectionHead(title: string, aside: string): HTMLElement {
  const head = element("div", "wh-section-head");
  head.append(element("h3", "wh-section-title", title));
  if (aside) head.append(element("span", "wh-muted", aside));
  return head;
}

function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = element("a", "wh-link", text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(icon(ICONS.out));
  return link;
}

function spark(values: number[], width: number, height: number, extra = ""): SVGSVGElement | HTMLElement {
  const { line, area, zero } = sparkline(values, width, height, 2);
  if (!line) return element("span", "wh-spark is-empty");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", `wh-spark ${extra} ${tone(values[values.length - 1] - values[0])}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const base = document.createElementNS(svg.namespaceURI, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", String(width));
  base.setAttribute("y1", zero.toFixed(1));
  base.setAttribute("y2", zero.toFixed(1));
  base.setAttribute("class", "wh-spark-zero");
  const fill = document.createElementNS(svg.namespaceURI, "path");
  fill.setAttribute("d", area);
  fill.setAttribute("class", "wh-spark-area");
  const stroke = document.createElementNS(svg.namespaceURI, "path");
  stroke.setAttribute("d", line);
  stroke.setAttribute("class", "wh-spark-line");
  svg.append(fill, base, stroke);
  return svg;
}

function tone(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return "";
  return value > 0 ? "is-up" : "is-down";
}

function hue(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash % 360;
}

interface Pager {
  readonly element: HTMLElement;
  readonly page: number;
  readonly pages: number;
  /** Sets how many items there are, and draws the page numbers. */
  update(total: number): void;
  /** Back to the first page, for a new list. */
  reset(): void;
}

function pager(label: string, onPage: (page: number) => void): Pager {
  const nav = element("nav", "wh-pager");
  nav.setAttribute("aria-label", label);
  let page = 1;
  let pages = 1;

  function go(next: number) {
    page = Math.min(Math.max(1, next), pages);
    draw();
    // The buttons are drawn again, so the focus moves to the page now showing.
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    onPage(page);
  }

  function draw() {
    nav.hidden = pages <= 1;
    if (nav.hidden) {
      nav.replaceChildren();
      return;
    }
    const previous = iconButton("wh-page wh-page-step", "Previous page", ICONS.back);
    previous.disabled = page === 1;
    previous.addEventListener("click", () => go(page - 1));
    const next = iconButton("wh-page wh-page-step", "Next page", ICONS.chevron);
    next.disabled = page === pages;
    next.addEventListener("click", () => go(page + 1));
    const numbers = pageList(page, pages).map((number) => {
      if (!number) {
        const gap = element("span", "wh-page-gap", "…");
        gap.setAttribute("aria-hidden", "true");
        return gap;
      }
      const button = element("button", "wh-page", String(number));
      button.type = "button";
      button.setAttribute("aria-label", `Page ${number}`);
      if (number === page) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => go(number));
      return button;
    });
    nav.replaceChildren(previous, ...numbers, next);
  }

  return {
    element: nav,
    get page() {
      return page;
    },
    get pages() {
      return pages;
    },
    update(total) {
      pages = Math.max(1, Math.ceil(total / PAGE));
      if (page > pages) page = pages;
      draw();
    },
    reset() {
      page = 1;
    },
  };
}

// After a page change the list's top comes back into view, so the new page starts where the eye is.
function keepInView(target: HTMLElement) {
  if (target.getBoundingClientRect().top >= 0) return;
  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
}
