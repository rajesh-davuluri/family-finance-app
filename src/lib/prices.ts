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

export async function yahooQuote(symbol: string, fetchFn: FetchFn = fetch): Promise<{ price: number; currency: string | null } | null> {
  try {
    const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: UA,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, currency: typeof meta?.currency === "string" ? meta.currency : null };
  } catch {
    return null;
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

export type PriceResult = { prices: Map<string, number>; failed: { symbol: string; reason: string }[]; usdInr: number | null };

export async function fetchPrices(targets: PriceTarget[], fetchFn: FetchFn = fetch): Promise<PriceResult> {
  const prices = new Map<string, number>();
  const failed: { symbol: string; reason: string }[] = [];

  const fxP = yahooQuote("INR=X", fetchFn);
  const needAmfi = targets.some((t) => t.exchange === "AMFI");
  const amfiP = needAmfi ? amfiNavs(fetchFn) : Promise.resolve(null);

  // A few at a time, to be polite to the free endpoint.
  const yahoo = targets.filter((t) => yahooSymbol(t));
  for (let i = 0; i < yahoo.length; i += 6) {
    await Promise.all(
      yahoo.slice(i, i + 6).map(async (t) => {
        const q = await yahooQuote(yahooSymbol(t)!, fetchFn);
        if (!q) failed.push({ symbol: t.symbol, reason: "not found" });
        else if (q.currency && q.currency.toUpperCase() !== t.currency.toUpperCase()) {
          failed.push({ symbol: t.symbol, reason: `quoted in ${q.currency}, holding is in ${t.currency}` });
        } else prices.set(t.id, q.price);
      }),
    );
  }

  const navs = await amfiP;
  for (const t of targets.filter((x) => x.exchange === "AMFI")) {
    const nav = navs?.get(t.symbol.trim().toUpperCase());
    if (nav) prices.set(t.id, nav);
    else failed.push({ symbol: t.symbol, reason: navs ? "scheme code not found" : "AMFI unavailable" });
  }

  const fx = await fxP;
  return { prices, failed, usdInr: fx && fx.price > 50 && fx.price < 200 ? fx.price : null };
}
