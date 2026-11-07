// Fetches current prices: shares, ETFs and crypto from Yahoo Finance's
// public chart endpoint (NSE "RELIANCE.NS", BSE "500325.BO", US "AAPL",
// crypto "BTC-USD"), Indian mutual fund NAVs from AMFI's daily file (by
// scheme code), and the USD/INR rate. Network only; the caller stores them.

type FetchFn = typeof fetch;

export type PriceTarget = { id: string; symbol: string; exchange: string; currency: string };

// Yahoo's ticker for a holding, or null when its price isn't on Yahoo.
export function yahooSymbol(h: { symbol: string; exchange: string; currency: string }): string | null {
  const s = h.symbol.trim().toUpperCase();
  if (!s) return null;
  switch (h.exchange) {
    case "NSE":
      return /\.(NS|BO)$/.test(s) ? s : `${s}.NS`;
    case "BSE":
      return /\.(NS|BO)$/.test(s) ? s : `${s}.BO`;
    case "US":
      return s.replace(/\./g, "-"); // BRK.B -> BRK-B
    case "CRYPTO":
      return s.includes("-") ? s : `${s}-${h.currency || "USD"}`;
    default:
      return null;
  }
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; FamilyFinance/1.0)" };

type Quote = { price: number; currency: string | null };
type Lookup = Quote | { error: string };
const isQuote = (q: Lookup): q is Quote => "price" in q;

// Why a lookup failed, in words someone can act on.
function httpReason(status: number) {
  if (status === 404) return "not listed";
  if (status === 429) return "HTTP 429 (too many requests)";
  if (status === 401 || status === 403) return `HTTP ${status} (refused)`;
  return `HTTP ${status}`;
}
const errReason = (e: unknown) => (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timed out" : "no connection");

async function yahooFrom(host: string, symbol: string, fetchFn: FetchFn): Promise<Lookup> {
  try {
    const res = await fetchFn(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: UA,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { error: httpReason(res.status) };
    const json = await res.json().catch(() => null);
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return { error: "no price in answer" };
    return { price, currency: typeof meta?.currency === "string" ? meta.currency : null };
  } catch (e) {
    return { error: errReason(e) };
  }
}

// Yahoo Finance's chart endpoint, trying its second host when the first
// refuses or fails (a 404 means the symbol isn't listed, so no retry).
export async function yahooQuote(symbol: string, fetchFn: FetchFn = fetch): Promise<Lookup> {
  const first = await yahooFrom("query1.finance.yahoo.com", symbol, fetchFn);
  if (isQuote(first) || first.error === "not listed") return first;
  const second = await yahooFrom("query2.finance.yahoo.com", symbol, fetchFn);
  return isQuote(second) ? second : { error: first.error === second.error ? first.error : `${first.error}, then ${second.error}` };
}

// Stooq's free quote CSV: the backup for US shares and the USD/INR rate.
// "Symbol,Date,Time,Open,High,Low,Close\nMSFT.US,2026-11-06,22:00:19,...,531.4"
export function stooqSymbol(t: { symbol: string; exchange: string }): string | null {
  return t.exchange === "US" ? `${t.symbol.trim().toLowerCase().replace(/\./g, "-")}.us` : null;
}

export function parseStooq(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0]?.toLowerCase().split(",") ?? [];
  const sym = head.indexOf("symbol");
  const close = head.indexOf("close");
  if (sym < 0 || close < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const price = Number(cells[close]);
    if (cells[sym] && Number.isFinite(price) && price > 0) out.set(cells[sym].toLowerCase(), price);
  }
  return out;
}

export async function stooqQuotes(symbols: string[], fetchFn: FetchFn = fetch): Promise<Map<string, number> | { error: string }> {
  if (!symbols.length) return new Map();
  try {
    const res = await fetchFn(`https://stooq.com/q/l/?s=${symbols.map(encodeURIComponent).join(",")}&f=sd2t2c&h&e=csv`, {
      headers: UA,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { error: httpReason(res.status) };
    return parseStooq(await res.text());
  } catch (e) {
    return { error: errReason(e) };
  }
}

// AMFI publishes every Indian mutual fund's latest NAV in one file:
// "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date"
export function parseAmfi(text: string): Map<string, number> {
  const navs = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(";");
    if (cells.length < 6 || !/^\d+$/.test(cells[0].trim())) continue;
    const nav = Number(cells[4]);
    if (Number.isFinite(nav) && nav > 0) {
      navs.set(cells[0].trim(), nav);
      // Also findable by ISIN.
      for (const isin of [cells[1], cells[2]]) if (isin && /^IN[A-Z0-9]{10}$/.test(isin.trim())) navs.set(isin.trim(), nav);
    }
  }
  return navs;
}

export async function amfiNavs(fetchFn: FetchFn = fetch): Promise<Map<string, number> | null> {
  try {
    const res = await fetchFn("https://www.amfiindia.com/spages/NAVAll.txt", { headers: UA, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!res.ok) return null;
    return parseAmfi(await res.text());
  } catch {
    return null;
  }
}

export type PriceResult = {
  prices: Map<string, number>;
  failed: { symbol: string; reason: string }[];
  usdInr: number | null;
  sources: Record<string, number>; // how many prices came from each source
};

const fxOk = (r: number | null | undefined) => (r && r > 50 && r < 200 ? r : null);

export async function fetchPrices(targets: PriceTarget[], fetchFn: FetchFn = fetch): Promise<PriceResult> {
  const prices = new Map<string, number>();
  const failed: { symbol: string; reason: string }[] = [];
  const sources: Record<string, number> = {};
  const got = (id: string, price: number, source: string) => {
    prices.set(id, price);
    sources[source] = (sources[source] ?? 0) + 1;
  };

  const fxP = yahooQuote("INR=X", fetchFn);
  const needAmfi = targets.some((t) => t.exchange === "AMFI");
  const amfiP = needAmfi ? amfiNavs(fetchFn) : Promise.resolve(null);

  // Yahoo first, a few at a time to be polite to the free endpoint.
  const yahooFailed: { t: PriceTarget; reason: string }[] = [];
  const yahoo = targets.filter((t) => yahooSymbol(t));
  for (let i = 0; i < yahoo.length; i += 6) {
    await Promise.all(
      yahoo.slice(i, i + 6).map(async (t) => {
        const q = await yahooQuote(yahooSymbol(t)!, fetchFn);
        if (!isQuote(q)) yahooFailed.push({ t, reason: `Yahoo: ${q.error}` });
        else if (q.currency && q.currency.toUpperCase() !== t.currency.toUpperCase()) {
          failed.push({ symbol: t.symbol, reason: `quoted in ${q.currency}, holding is in ${t.currency}` });
        } else got(t.id, q.price, "Yahoo");
      }),
    );
  }

  // Stooq for US shares Yahoo couldn't price, and for the rate if needed.
  let fx = await fxP;
  const backup = yahooFailed.filter((x) => stooqSymbol(x.t));
  const wantFx = !isQuote(fx) || !fxOk(fx.price);
  if (backup.length || wantFx) {
    const syms = [...backup.map((x) => stooqSymbol(x.t)!), ...(wantFx ? ["usdinr"] : [])];
    const st = await stooqQuotes(syms, fetchFn);
    for (const x of yahooFailed) {
      const s = stooqSymbol(x.t);
      const p = s && st instanceof Map ? st.get(s) : undefined;
      if (p) got(x.t.id, p, "Stooq");
      else failed.push({ symbol: x.t.symbol, reason: s ? `${x.reason}; Stooq: ${st instanceof Map ? "no price" : st.error}` : x.reason });
    }
    if (wantFx && st instanceof Map && fxOk(st.get("usdinr"))) fx = { price: st.get("usdinr")!, currency: "INR" };
  } else {
    for (const x of yahooFailed) failed.push({ symbol: x.t.symbol, reason: x.reason });
  }

  const navs = await amfiP;
  for (const t of targets.filter((x) => x.exchange === "AMFI")) {
    const nav = navs?.get(t.symbol.trim().toUpperCase());
    if (nav) got(t.id, nav, "AMFI");
    else failed.push({ symbol: t.symbol, reason: navs ? "scheme code not found" : "AMFI unavailable" });
  }

  return { prices, failed, usdInr: isQuote(fx) ? fxOk(fx.price) : null, sources };
}
