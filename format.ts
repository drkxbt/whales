/** Shown for a value the API didn't give, so a gap never reads as zero. */
export const EMPTY = "–";

const MINUS = "−";

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1e4) return Math.round(abs).toLocaleString("en-US");
  // Rounded before the unit is picked, so 999.6M reads 1B rather than 1000M.
  const rounded = Number(abs.toPrecision(3));
  if (rounded >= 1e9) return `${trim(rounded / 1e9)}B`;
  if (rounded >= 1e6) return `${trim(rounded / 1e6)}M`;
  return `${trim(rounded / 1e3)}K`;
}

// Three significant figures reads well at every size: 1.24M, 12.4M, 124M. Only zeros after a decimal point go.
function trim(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return digits ? text.replace(/\.?0+$/, "") : text;
}

const valid = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** $1.24M, $48.2K, $820. */
export function formatUsd(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return `${value < 0 ? MINUS : ""}$${compact(value)}`;
}

/** +$1.24M or −$48.2K, for profit and loss. */
export function formatPnl(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  if (Math.abs(value) < 0.5) return "$0";
  return `${value > 0 ? "+" : MINUS}$${compact(value)}`;
}

/** A coin's price at the precision traders read it: 80,670 · 3,412.5 · 1.2345 · 0.0004213. */
export function formatPrice(price: number | null | undefined): string {
  if (!valid(price)) return EMPTY;
  const abs = Math.abs(price);
  if (abs === 0) return "0";
  if (abs >= 1) {
    const digits = abs >= 10_000 ? 0 : abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 10 ? 3 : 4;
    return price.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }
  // Below a dollar, four significant figures, written out rather than in exponent form.
  const decimals = Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(abs))));
  return price.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

/** 12%, +12%, −3.4%. `signed` adds the plus. Takes a percentage, not a fraction. */
export function formatPercent(value: number | null | undefined, signed = false): string {
  if (!valid(value)) return EMPTY;
  const abs = Math.abs(value);
  const text = abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs >= 10 ? abs.toFixed(0) : abs.toFixed(1).replace(/\.0$/, "");
  if (text === "0") return "0%";
  return `${value < 0 ? MINUS : signed ? "+" : ""}${text}%`;
}

/** 20×, 3.5×. */
export function formatLeverage(value: number | null | undefined): string {
  if (!valid(value) || value <= 0) return EMPTY;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}×`;
}

/** A position's size in its coin: 1,250 ETH, 0.42 BTC, 1.2M PEPE. */
export function formatSize(size: number | null | undefined, coin = ""): string {
  if (!valid(size)) return EMPTY;
  const abs = Math.abs(size);
  const text = abs >= 1e4 ? compact(abs) : abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs >= 1 ? trim(abs) : Number(abs.toPrecision(3)).toString();
  return coin ? `${text} ${coin}` : text;
}

/** How long ago, in the units a feed uses: 8s, 4m, 3h, 2d. */
export function formatAge(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** 0xf031…c80c. */
export function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

/** A trader's name, or the short wallet when they never set one. */
export function displayName(name: string, wallet: string): string {
  return name ? name : shortWallet(wallet);
}
