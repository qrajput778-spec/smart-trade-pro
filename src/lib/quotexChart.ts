// Ported chart engine for SMART TRADE PRO's trading terminal.
//
// This is a faithful port of the candlestick chart, timeframe tabs,
// indicator engine, market dropdown, and live Binance/TradingView data
// feed originally built as a standalone HTML/canvas prototype
// (Downloads/html quotex/Demo TT.html) — every drawing routine, indicator
// formula, and interaction (crosshair, dropdown, tabs) below is copied
// over unchanged from that source, just relocated from global
// `document.getElementById` calls into a scoped `mountTradingChart()`
// function so it can live inside a React component's lifecycle instead of
// owning the whole page.
//
// Deliberately NOT ported from that source, per this app's real trading
// architecture (src/lib/trading.ts, src/pages/Trade.tsx already cover
// this correctly):
//   - The fake leveraged/binary-options order panel, its win/lose popup,
//     toast, and audio — this app's real Buy/Sell uses actual spot
//     quantities against the user's real Firestore balance/holdings, not
//     a timed-expiry leveraged bet with a random/tiered payout.
//   - The 40-day "market chain" open/closed schedule — every symbol this
//     app tracks is crypto, and that schedule always evaluates "open" for
//     every crypto pair on every day, so dropping it changes nothing
//     observable; it only ever gated the fake order panel's buttons.

export interface TradingChartHandle {
  /** Switches the chart's active market — e.g. when the route's :symbol changes. */
  setSymbol: (pair: string) => void
  /** Tears down all intervals/timeouts/sockets/listeners this chart owns. */
  destroy: () => void
}

export interface TradingChartOptions {
  /** e.g. "BTC/USDT" */
  initialSymbol: string
  /** Fired when the user picks a different market from the chart's own dropdown. */
  onSymbolChange?: (pair: string) => void
}

interface Candle {
  o: number
  h: number
  l: number
  c: number
  t: number
  v: number
}

interface SeriesState {
  data: Candle[]
  price: number
  live: boolean
  anchor?: number
  tvPrice?: number
  noise?: number
}

interface MarketDef {
  cat: string
  name: string
  base: number
  dp: number
}

export const MARKET_DEFS: Record<string, MarketDef> = {
  'BTC/USDT': { cat: 'Crypto', name: 'Bitcoin', base: 97000, dp: 0 },
  'ETH/USDT': { cat: 'Crypto', name: 'Ethereum', base: 3420, dp: 1 },
  'SOL/USDT': { cat: 'Crypto', name: 'Solana', base: 188.5, dp: 2 },
  'BNB/USDT': { cat: 'Crypto', name: 'BNB', base: 652, dp: 1 },
  'XRP/USDT': { cat: 'Crypto', name: 'XRP', base: 2.24, dp: 4 },
}

const CRYPTO_ORDER = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT']
const TIMEFRAMES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1D': 1440, '1W': 10080 }
const BINANCE_TF: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w' }
const TV_TICKERS: Record<string, string> = {
  'BTC/USDT': 'BINANCE:BTCUSDT',
  'ETH/USDT': 'BINANCE:ETHUSDT',
  'SOL/USDT': 'BINANCE:SOLUSDT',
  'BNB/USDT': 'BINANCE:BNBUSDT',
  'XRP/USDT': 'BINANCE:XRPUSDT',
}

const IND_COLORS: Record<string, string> = {
  rsi: '#f5b301', stoch: '#f5b301', macd: '#f5b301', atr: '#2962ff', cci: '#2962ff', adx: '#2962ff', volume: '#26a69a',
  sma: '#2962ff', ema: '#ff6d00', bb: '#2962ff', vwap: '#ff9800', supertrend: '#26a69a', ichimoku: '#2962ff',
}
const IND_NAMES: Record<string, string> = {
  rsi: 'RSI (14)', stoch: 'Stoch (14,3,3)', macd: 'MACD (12,26,9)', atr: 'ATR (14)', cci: 'CCI (20)', adx: 'ADX (14)', volume: 'Volume',
  sma: 'SMA (50)', ema: 'EMA (20)', bb: 'BB (20,2)', vwap: 'VWAP', supertrend: 'SuperTrend (10,3)', ichimoku: 'Ichimoku (9,26,52)',
}
const INDS: Record<string, { panel: boolean }> = {
  rsi: { panel: true }, stoch: { panel: true }, macd: { panel: true }, atr: { panel: true }, cci: { panel: true }, adx: { panel: true }, volume: { panel: true },
  sma: { panel: false }, ema: { panel: false }, bb: { panel: false }, vwap: { panel: false }, supertrend: { panel: false }, ichimoku: { panel: false },
}

const PANEL_H = 96
const PANEL_GAP = 4

// ---------------------------------------------------------------------------
// Pure indicator math — copied verbatim from the source prototype.
// ---------------------------------------------------------------------------
function smaArr(c: number[], p: number) {
  const out: (number | null)[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { out.push(null); continue }
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += c[j]
    out.push(s / p)
  }
  return out
}
function emaArr(c: number[], p: number) {
  const k = 2 / (p + 1)
  const out: number[] = []
  let prev: number | null = null
  for (let i = 0; i < c.length; i++) {
    prev = prev == null ? c[i] : c[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}
function stdevArr(c: number[], p: number) {
  const out: (number | null)[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { out.push(null); continue }
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += c[j]
    const m = s / p
    let v = 0
    for (let j = i - p + 1; j <= i; j++) v += (c[j] - m) ** 2
    out.push(Math.sqrt(v / p))
  }
  return out
}
function rsiArr(c: number[], p: number) {
  const out: (number | null)[] = [null]
  let g = 0, l = 0
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    if (i <= p) { g += gain; l += loss; if (i === p) { g /= p; l /= p } }
    else { g = (g * (p - 1) + gain) / p; l = (l * (p - 1) + loss) / p }
    if (i < p) { out.push(null); continue }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l))
  }
  return out
}
function stochArr(data: Candle[], p: number, s: number) {
  const K: number[] = []
  for (let i = 0; i < data.length; i++) {
    let hh = -Infinity, ll = Infinity
    for (let j = Math.max(0, i - p + 1); j <= i; j++) { hh = Math.max(hh, data[j].h); ll = Math.min(ll, data[j].l) }
    K.push(ll === hh ? 50 : ((data[i].c - ll) / (hh - ll)) * 100)
  }
  const sm = (a: number[], n: number) => {
    const o: number[] = []
    for (let i = 0; i < a.length; i++) {
      let t = 0
      for (let j = Math.max(0, i - n + 1); j <= i; j++) t += a[j]
      o.push(t / (i - Math.max(0, i - n + 1) + 1))
    }
    return o
  }
  const k = sm(K, s), d = sm(k, s)
  return { k, d }
}
function atrArr(data: Candle[], p: number) {
  const out: (number | null)[] = [null]
  let prevTR: number | null = null
  for (let i = 0; i < data.length; i++) {
    const d = data[i], pn = data[i - 1]
    const tr = pn ? Math.max(d.h - d.l, Math.abs(d.h - pn.c), Math.abs(d.l - pn.c)) : d.h - d.l
    if (i === 0) { out[0] = tr; prevTR = tr; continue }
    prevTR = (prevTR! * (p - 1) + tr) / p
    out.push(prevTR)
  }
  return out
}
function macdArr(c: number[]) {
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26)
  const macd = c.map((_, i) => e12[i] - e26[i])
  const signal = emaArr(macd, 9)
  const hist = macd.map((v, i) => v - signal[i])
  return { macd, signal, hist }
}
function cciArr(data: Candle[], p: number) {
  const out: (number | null)[] = []
  const tp = data.map((d) => (d.h + d.l + d.c) / 3)
  for (let i = 0; i < data.length; i++) {
    if (i < p - 1) { out.push(null); continue }
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += tp[j]
    const ma = s / p
    let md = 0
    for (let j = i - p + 1; j <= i; j++) md += Math.abs(tp[j] - ma)
    const meanDev = md / p
    out.push(meanDev === 0 ? 0 : (tp[i] - ma) / (0.015 * meanDev))
  }
  return out
}
function adxArr(data: Candle[], p: number) {
  const n = data.length
  const out: (number | null)[] = []
  const tr: number[] = [], pd: number[] = [], md: number[] = []
  for (let i = 0; i < n; i++) {
    const d = data[i], pn = data[i - 1]
    const up = pn ? d.h - pn.h : 0, dn = pn ? pn.l - d.l : 0
    pd.push(up > dn && up > 0 ? up : 0)
    md.push(dn > up && dn > 0 ? dn : 0)
    tr.push(pn ? Math.max(d.h - d.l, Math.abs(d.h - pn.c), Math.abs(d.l - pn.c)) : d.h - d.l)
  }
  let atr = tr[0] || 1, pS = pd[0] || 0, mS = md[0] || 0, adx = 30
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push(null); continue }
    if (i < p) {
      pS += pd[i]; mS += md[i]; atr += tr[i]
      if (i === p - 1) { pS /= p; mS /= p; atr /= p }
      out.push(null)
      continue
    }
    pS = (pS * (p - 1) + pd[i]) / p
    mS = (mS * (p - 1) + md[i]) / p
    atr = (atr * (p - 1) + tr[i]) / p
    const pdi = atr ? (pS / atr) * 100 : 0
    const mdi = atr ? (mS / atr) * 100 : 0
    const dxv = pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100
    adx = (adx * (p - 1) + dxv) / p
    out.push(adx)
  }
  return out
}
function vwapArr(data: Candle[]) {
  const out: number[] = []
  let pv = 0, vol = 0
  for (const d of data) {
    const tp = (d.h + d.l + d.c) / 3, v = d.v || 0
    pv += tp * v
    vol += v
    out.push(vol > 0 ? pv / vol : tp)
  }
  return out
}
function superTrend(data: Candle[], p: number, m: number) {
  const atr = atrArr(data, p)
  const out: { v: number; up: boolean }[] = []
  const ub: number[] = [], lb: number[] = []
  let dir = 1, lastSt: number | null = null
  for (let i = 0; i < data.length; i++) {
    const mid = (data[i].h + data[i].l) / 2
    const bUp = mid + m * (atr[i] || 0), bDn = mid - m * (atr[i] || 0)
    let up = bUp, dn = bDn
    if (i > 0) {
      up = bUp < ub[i - 1] || data[i - 1].c > ub[i - 1] ? bUp : ub[i - 1]
      dn = bDn > lb[i - 1] || data[i - 1].c < lb[i - 1] ? bDn : lb[i - 1]
    }
    ub.push(up); lb.push(dn)
    if (i === 0) { dir = 1; lastSt = up; out.push({ v: up, up: true }); continue }
    if (lastSt === lb[i - 1] && data[i].c > up) dir = 1
    else if (lastSt === ub[i - 1] && data[i].c < dn) dir = -1
    const st = dir === 1 ? dn : up
    out.push({ v: st, up: dir === 1 })
    lastSt = st
  }
  return out
}
function ichimoku(data: Candle[]) {
  const conv: number[] = [], base: number[] = [], spanA: number[] = [], spanB: number[] = []
  for (let i = 0; i < data.length; i++) {
    let h1 = -Infinity, l1 = Infinity, h2 = -Infinity, l2 = Infinity, h3 = -Infinity, l3 = Infinity
    for (let j = Math.max(0, i - 8); j <= i; j++) { h1 = Math.max(h1, data[j].h); l1 = Math.min(l1, data[j].l) }
    for (let j = Math.max(0, i - 25); j <= i; j++) { h2 = Math.max(h2, data[j].h); l2 = Math.min(l2, data[j].l) }
    for (let j = Math.max(0, i - 51); j <= i; j++) { h3 = Math.max(h3, data[j].h); l3 = Math.min(l3, data[j].l) }
    const c = (h1 + l1) / 2, b = (h2 + l2) / 2
    conv.push(c); base.push(b); spanA.push((c + b) / 2); spanB.push((h3 + l3) / 2)
  }
  return { conv, base, spanA, spanB }
}
function candlestickPatterns(d: Candle[]) {
  const n = d.length
  if (n < 3) return [] as string[]
  const out: string[] = []
  const prev = d[n - 3], prev2 = d[n - 2], cur = d[n - 1]
  const body = Math.abs(cur.c - cur.o), rng = cur.h - cur.l
  const upper = cur.h - Math.max(cur.c, cur.o), lower = Math.min(cur.c, cur.o) - cur.l
  if (rng > 0) {
    if (body < rng * 0.1) out.push('DOJI')
    if (lower > rng * 0.6 && upper < rng * 0.1) out.push('HAMMER')
    if (upper > rng * 0.6 && lower < rng * 0.1) out.push('SHOOTING STAR')
    if (body / rng > 0.7 && cur.c >= cur.o && prev.c >= prev.o && cur.o >= prev.c) out.push('BULLISH ENGULFING')
    if (body / rng > 0.7 && cur.c <= cur.o && prev.c <= prev.o && cur.o <= prev.c && prev2.c > prev2.o) out.push('BEARISH ENGULFING')
    if (cur.c > cur.o && body / rng > 0.85) out.push('MARUBOZU')
  }
  return out
}

function formatPrice(v: number, dp: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp || (v >= 100 ? 0 : 2) })
}

function fetchJSON<T>(url: string, timeout: number): Promise<T | null> {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), timeout)
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
      .then((d) => { clearTimeout(t); resolve(d as T) })
      .catch(() => { clearTimeout(t); resolve(null) })
  })
}

async function loadBinance(sym: string, tfLabel: string): Promise<Candle[] | null> {
  const pair = sym.replace('/USDT', 'USDT')
  const interval = BINANCE_TF[tfLabel] || '1m'
  const limit = 160
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
  const data = await fetchJSON<unknown[][]>(url, 8000)
  if (!data || !data.length) return null
  return data.map((k) => ({ o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, t: +k[0]!, v: +k[5]! }))
}

/**
 * Mounts the chart into `root` (which must already contain the exact DOM
 * structure TradingChartWidget.tsx renders) and wires up every interval,
 * socket, and listener it owns. Returns a handle for switching symbols and
 * tearing everything down again — call `destroy()` on unmount.
 */
export function mountTradingChart(root: HTMLElement, options: TradingChartOptions): TradingChartHandle {
  const canvasOrNull = root.querySelector<HTMLCanvasElement>('canvas.stp-chart-canvas')
  const ctxOrNull = canvasOrNull?.getContext('2d')
  const tipOrNull = root.querySelector<HTMLDivElement>('.stp-crosshair-tip')
  const symElOrNull = root.querySelector<HTMLElement>('.stp-chart-sym')
  const priceElOrNull = root.querySelector<HTMLElement>('.stp-live-price')
  const changeElOrNull = root.querySelector<HTMLElement>('.stp-tick-pct')
  const badgeTfElOrNull = root.querySelector<HTMLElement>('.stp-badge-tf')
  const badgeMarketElOrNull = root.querySelector<HTMLElement>('.stp-badge-market')
  const legendElOrNull = root.querySelector<HTMLElement>('.stp-ind-legend')
  const dropdownBtnOrNull = root.querySelector<HTMLButtonElement>('.stp-market-dropdown-btn')
  const dropdownMenuOrNull = root.querySelector<HTMLDivElement>('.stp-market-dropdown-menu')
  const dropdownRootOrNull = root.querySelector<HTMLDivElement>('.stp-market-dropdown')
  const indicatorSelectOrNull = root.querySelector<HTMLSelectElement>('.stp-ind-select')
  const tfTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.stp-tf-tab[data-tf]'))

  if (
    !canvasOrNull || !ctxOrNull || !tipOrNull || !symElOrNull || !priceElOrNull || !changeElOrNull ||
    !badgeTfElOrNull || !badgeMarketElOrNull || !legendElOrNull || !dropdownBtnOrNull || !dropdownMenuOrNull ||
    !dropdownRootOrNull || !indicatorSelectOrNull
  ) {
    // Should never happen — TradingChartWidget.tsx always renders this exact structure.
    return { setSymbol: () => {}, destroy: () => {} }
  }

  // Re-bound with non-null types: the guard above already proved these exist
  // at runtime, but TypeScript's control-flow narrowing doesn't carry into
  // the nested `function` declarations below that close over them, so the
  // original nullable bindings would otherwise need a redundant `!` at every
  // single usage site.
  const canvas = canvasOrNull
  const ctx = ctxOrNull
  const tip = tipOrNull
  const symEl = symElOrNull
  const priceEl = priceElOrNull
  const changeEl = changeElOrNull
  const badgeTfEl = badgeTfElOrNull
  const badgeMarketEl = badgeMarketElOrNull
  const legendEl = legendElOrNull
  const dropdownBtn = dropdownBtnOrNull
  const dropdownMenu = dropdownMenuOrNull
  const dropdownRoot = dropdownRootOrNull
  const indicatorSelect = indicatorSelectOrNull

  const state = {
    active: MARKET_DEFS[options.initialSymbol] ? options.initialSymbol : 'BTC/USDT',
    tf: 1,
    tfLabel: '1m',
    indicators: [] as string[],
    series: {} as Record<string, SeriesState>,
  }

  const intervalIds: number[] = []
  let ws: WebSocket | null = null
  let wsActive = ''
  // Guards every async continuation below (initial load, the 20s/6s
  // refreshes) against still touching this shared DOM after destroy() —
  // clearInterval only stops *future* ticks, not one already in flight,
  // and in dev, React 18 StrictMode intentionally mounts this twice
  // (mount → cleanup → mount) against the very same DOM to catch exactly
  // this kind of bug.
  let destroyed = false
  let wsTF = ''

  function alignTF(now: number) {
    const tfms = state.tf * 60000
    if (tfms >= 86400000) {
      const d = new Date(now)
      d.setMilliseconds(0); d.setSeconds(0); d.setMinutes(0); d.setHours(0)
      if (tfms >= 604800000) { const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day) }
      return d.getTime()
    }
    return Math.floor(now / tfms) * tfms
  }

  function seedSeries(sym: string, startPrice?: number) {
    const cfg = MARKET_DEFS[sym]
    let price = startPrice != null ? startPrice : cfg.base
    const data: Candle[] = []
    const now = Date.now()
    const tfms = state.tf * 60000
    const aligned = alignTF(now)
    for (let i = 0; i < 90; i++) {
      const open = price, drift = Math.random() - 0.485, close = open * (1 + drift * 0.006)
      const vol = 1 + Math.random() * 0.003
      const high = Math.max(open, close) * vol, low = Math.min(open, close) * (2 - vol)
      data.push({ o: open, h: high, l: low, c: close, t: aligned - (90 - i) * tfms, v: 100000 + Math.random() * 900000 })
      price = close
    }
    state.series[sym] = { data, price, live: false }
  }

  function nextOpen(sym: string) {
    const s = state.series[sym]
    const last = s.data[s.data.length - 1]
    return last ? last.c : s.price
  }

  function tick(sym: string) {
    const s = state.series[sym]
    if (!s) return
    if (s.live) return
    const last = s.data[s.data.length - 1], lastT = last ? last.t : 0, now = Date.now(), tfms = state.tf * 60000
    if (lastT && now - lastT >= tfms) {
      s.data.push({ o: nextOpen(sym), h: nextOpen(sym), l: nextOpen(sym), c: nextOpen(sym), t: alignTF(now), v: 100000 + Math.random() * 900000 })
      if (s.data.length > 220) s.data.shift()
    }
    const c = s.data[s.data.length - 1]
    const volatility = 0.0015 + Math.random() * 0.0012, drift = Math.random() - 0.495, move = c.c * drift * volatility
    c.c = Math.max(c.c + move, c.c * 0.7)
    c.h = Math.max(c.h, c.c)
    c.l = Math.min(c.l, c.c)
    s.price = c.c
  }

  async function loadLiveInitial(sym: string): Promise<boolean> {
    const def = MARKET_DEFS[sym]
    try {
      const candles = await loadBinance(sym, state.tfLabel)
      if (candles && candles.length > 2) {
        const s: SeriesState = { data: candles, price: candles[candles.length - 1].c, live: true }
        s.anchor = s.price
        state.series[sym] = s
        return true
      }
    } catch {
      // fall through to the offline seed below
    }
    seedSeries(sym, def.base)
    state.series[sym].live = false
    return false
  }

  function chartData(): Candle[] {
    const s = state.series[state.active]
    if (!s || !s.data || !s.data.length) return s ? s.data : []
    return s.data.slice(-Math.min(120, s.data.length))
  }

  function priceRange(): [number, number] {
    const data = chartData()
    let min = Infinity, max = -Infinity
    for (const c of data) { if (c.l < min) min = c.l; if (c.h > max) max = c.h }
    const pad = (max - min) * 0.12 || 1
    return [min - pad, max + pad]
  }

  function mainChartH(H: number) {
    const r = panelRects(H)
    return r.length ? r[0].y0 : H
  }

  function panelRects(H: number) {
    const ids = state.indicators.filter((id) => INDS[id] && INDS[id].panel)
    const maxP = Math.max(0, Math.floor((H - 150) / (PANEL_H + PANEL_GAP)))
    const use = ids.slice(0, maxP)
    const rects: { id: string; y0: number; y1: number }[] = []
    let cursor = H
    for (const id of use) { cursor -= PANEL_H; rects.push({ id, y0: cursor, y1: cursor + PANEL_H }) }
    return rects
  }

  function drawGrid(w: number, h: number) {
    const MH = mainChartH(h)
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.font = '10px Segoe UI'; ctx.textAlign = 'left'
    for (let y = 0; y < MH; y += 34) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke() }
    ctx.textAlign = 'right'
    const [min, max] = priceRange()
    const nr = 5
    for (let i = 0; i <= nr; i++) {
      const v = min + ((max - min) * i) / nr, y = MH - ((v - min) / (max - min)) * MH
      const dp = MARKET_DEFS[state.active].dp
      ctx.fillText(formatPrice(v, dp), w - 8, y - 3)
    }
  }

  function candleX(i: number, count: number, w: number) {
    return i * (w / count) + w / count / 2
  }

  function renderChart() {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight
    if (!W || !H) return
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    drawGrid(W, H)
    const s = state.series[state.active]
    if (!s || s.data.length === 0) return
    const data = chartData()
    const [min, max] = priceRange(), range = max - min, count = data.length, cw = W / count, pad = cw * 0.28
    const MH = mainChartH(H)
    const BW = Math.max(pad * 2, 2)
    for (let i = 0; i < count; i++) {
      const d = data[i], x = candleX(i, count, W), y = (v: number) => MH - ((v - min) / range) * MH
      const isUp = d.c >= d.o
      const col = isUp ? '#26a69a' : '#ef5350'
      ctx.strokeStyle = col; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, y(d.h)); ctx.lineTo(x, y(d.l)); ctx.stroke()
      const top = y(Math.max(d.o, d.c)), bot = y(Math.min(d.o, d.c))
      const bodyH = Math.max(bot - top, 1)
      ctx.fillStyle = col; ctx.fillRect(x - BW / 2, top, BW, bodyH)
      if (i === count - 1) {
        ctx.lineWidth = 1.4; ctx.strokeStyle = col
        ctx.strokeRect(x - BW / 2 - 1.5, top - 1.5, BW + 3, bodyH + 3)
        ctx.save()
        ctx.globalAlpha = 0.12; ctx.lineWidth = 6; ctx.strokeStyle = col
        ctx.strokeRect(x - BW / 2, top, BW, bodyH)
        ctx.restore()
      }
    }
    const last = data[count - 1], py = MH - ((last.c - min) / range) * MH, dp = MARKET_DEFS[state.active].dp
    ctx.strokeStyle = '#ffffff'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); ctx.setLineDash([])
    const txt = formatPrice(last.c, dp), tw = ctx.measureText(txt).width + 10
    ctx.fillStyle = '#ffffff'; ctx.fillRect(W - tw, py - 9, tw, 16)
    ctx.fillStyle = '#000000'; ctx.textAlign = 'right'; ctx.fillText(txt, W - 5, py + 3.5)
  }

  function drawOverlay(id: string, data: Candle[], count: number, px: (i: number) => number, py: (v: number) => number, closes: number[]) {
    if (id === 'sma') {
      const ma = smaArr(closes, 50); ctx.strokeStyle = IND_COLORS.sma; ctx.lineWidth = 1.5; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (ma[i] == null) { st = false; continue } const x = px(i), y = py(ma[i]!); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
    } else if (id === 'ema') {
      const ma = emaArr(closes, 20); ctx.strokeStyle = IND_COLORS.ema; ctx.lineWidth = 1.5; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (ma[i] == null) { st = false; continue } const x = px(i), y = py(ma[i]); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
    } else if (id === 'bb') {
      const ma = smaArr(closes, 20), sd = stdevArr(closes, 20)
      const up = ma.map((v, i) => (v == null || sd[i] == null ? null : v + 2 * sd[i]!))
      const dn = ma.map((v, i) => (v == null || sd[i] == null ? null : v - 2 * sd[i]!))
      ctx.strokeStyle = IND_COLORS.bb; ctx.lineWidth = 1
      let st = false; ctx.beginPath()
      for (let i = 0; i < count; i++) { if (up[i] == null) { st = false; continue } const x = px(i), y = py(up[i]!); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      st = false; ctx.beginPath()
      for (let i = 0; i < count; i++) { if (dn[i] == null) { st = false; continue } const x = px(i), y = py(dn[i]!); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      let a = -1, b = -1
      for (let i = 0; i < count; i++) { if (up[i] !== null && dn[i] !== null) { if (a < 0) a = i; b = i } }
      if (a >= 0) {
        ctx.fillStyle = 'rgba(41,98,255,.06)'; ctx.beginPath()
        for (let i = a; i <= b; i++) { const x = px(i), y = py(up[i]!); i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
        for (let i = b; i >= a; i--) { const x = px(i), y = py(dn[i]!); ctx.lineTo(x, y) }
        ctx.closePath(); ctx.fill()
      }
    } else if (id === 'vwap') {
      const v = vwapArr(data); ctx.strokeStyle = IND_COLORS.vwap; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = py(v[i]); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
    } else if (id === 'supertrend') {
      const stl = superTrend(data, 10, 3)
      for (let i = 1; i < count; i++) {
        const a = stl[i - 1], b = stl[i]
        if (!a || !b) continue
        ctx.strokeStyle = b.up ? '#26a69a' : '#ef5350'; ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.moveTo(px(i - 1), py(a.v)); ctx.lineTo(px(i), py(b.v)); ctx.stroke()
      }
    } else if (id === 'ichimoku') {
      const ic = ichimoku(data)
      let a = -1, b = -1
      for (let i = 0; i < count; i++) { if (ic.spanA[i] !== null && ic.spanB[i] !== null) { if (a < 0) a = i; b = i } }
      if (a >= 0) {
        ctx.fillStyle = 'rgba(41,98,255,.08)'; ctx.beginPath()
        for (let i = a; i <= b; i++) { const x = px(i), y = py(ic.spanA[i]); i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
        for (let i = b; i >= a; i--) { const x = px(i), y = py(ic.spanB[i]); ctx.lineTo(x, y) }
        ctx.closePath(); ctx.fill()
      }
      ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = py(ic.conv[i]); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.strokeStyle = '#ff6d00'; ctx.beginPath(); st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = py(ic.base[i]); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
    }
  }

  function drawPanel(id: string, rect: { y0: number; y1: number }, data: Candle[], count: number, cw: number) {
    const W = canvas.clientWidth, X0 = rect.y0, X1 = rect.y1, topPad = 16
    const px = (i: number) => i * cw + cw / 2
    const sy = (v: number, v0: number, v1?: number) => {
      const lo = v0, hi = v1 || v0 + 1, span = hi - lo || 1
      return X1 - topPad - ((v - lo) / span) * (X1 - topPad - X0 - 4)
    }
    const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(2))
    const closes = data.map((d) => d.c)
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, X0 + 0.5); ctx.lineTo(W, X0 + 0.5); ctx.stroke()
    ctx.fillStyle = '#93A0C4'; ctx.font = 'bold 9px Segoe UI'; ctx.textAlign = 'left'
    if (id === 'volume') {
      const vols = data.map((d) => d.v || 0)
      const mx = Math.max(...(vols.length ? vols : [1]), 1) * 1.05
      const bh = X1 - topPad - X0 - 4, bw = Math.max(cw * 0.55, 1)
      for (let i = 0; i < count; i++) {
        const col = data[i].c >= data[i].o ? 'rgba(38,166,154,.45)' : 'rgba(239,83,80,.45)'
        const h = (vols[i] / mx) * bh
        ctx.fillStyle = col; ctx.fillRect(px(i) - bw / 2, X1 - topPad - h, bw, Math.max(h, 1))
      }
      ctx.fillText('Vol  ' + fmt(vols[count - 1] || 0), 4, X0 + 12)
      return
    }
    if (id === 'rsi') {
      const r = rsiArr(closes, 14)
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      for (const lv of [70, 30]) { const y = sy(lv, 0, 100); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
      ctx.setLineDash([])
      ctx.strokeStyle = IND_COLORS.rsi; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (r[i] == null) { st = false; continue } const x = px(i), y = sy(r[i]!, 0, 100); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('RSI (14)  ' + (r[count - 1] != null ? r[count - 1]!.toFixed(1) : ''), 4, X0 + 12)
      return
    }
    if (id === 'stoch') {
      const sk = stochArr(data, 14, 3)
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      for (const lv of [80, 20]) { const y = sy(lv, 0, 100); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
      ctx.setLineDash([])
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#2962ff'; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = sy(sk.k[i], 0, 100); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.strokeStyle = '#ff6d00'; ctx.beginPath(); st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = sy(sk.d[i], 0, 100); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('Stoch (14,3,3)  ' + sk.d[count - 1].toFixed(1), 4, X0 + 12)
      return
    }
    if (id === 'macd') {
      const m = macdArr(closes)
      let mn = Infinity, mx = -Infinity
      const all = m.macd.concat(m.signal).filter((v) => v != null)
      for (const v of all) { if (v < mn) mn = v; if (v > mx) mx = v }
      const pad = (mx - mn) * 0.25 || 1
      const y0 = sy(0, mn - pad, mx + pad)
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke()
      const bw = Math.max(cw * 0.35, 1)
      for (let i = 0; i < count; i++) {
        const h = m.hist[i], y1 = sy(h, mn - pad, mx + pad)
        ctx.fillStyle = h >= 0 ? 'rgba(38,166,154,.6)' : 'rgba(239,83,80,.6)'
        ctx.fillRect(px(i) - bw / 2, Math.min(y0, y1), bw, Math.max(Math.abs(y1 - y0), 1))
      }
      ctx.lineWidth = 1.3; ctx.strokeStyle = '#2962ff'; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = sy(m.macd[i], mn - pad, mx + pad); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.strokeStyle = '#ff6d00'; ctx.beginPath(); st = false
      for (let i = 0; i < count; i++) { const x = px(i), y = sy(m.signal[i], mn - pad, mx + pad); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('MACD (12,26,9)  ' + m.macd[count - 1].toFixed(2), 4, X0 + 12)
      return
    }
    if (id === 'atr') {
      const a = atrArr(data, 14)
      let mx = 0
      for (const v of a) if (v && v > mx) mx = v
      const hi = mx * 1.05 || 1
      ctx.strokeStyle = IND_COLORS.atr; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (a[i] == null) { st = false; continue } const x = px(i), y = sy(a[i]!, 0, hi); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('ATR (14)  ' + (a[count - 1] != null ? a[count - 1]!.toFixed(2) : ''), 4, X0 + 12)
      return
    }
    if (id === 'cci') {
      const c = cciArr(data, 20)
      let mn = Infinity, mx = -Infinity
      for (const v of c) { if (v == null) continue; mn = Math.min(mn, v); mx = Math.max(mx, v) }
      mn = Math.min(mn, -100); mx = Math.max(mx, 100)
      const pad = (mx - mn) * 0.1 || 1
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      for (const lv of [100, -100]) { const y = sy(lv, mn - pad, mx + pad); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
      ctx.setLineDash([])
      ctx.strokeStyle = IND_COLORS.cci; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (c[i] == null) { st = false; continue } const x = px(i), y = sy(c[i]!, mn - pad, mx + pad); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('CCI (20)  ' + (c[count - 1] != null ? c[count - 1]!.toFixed(0) : ''), 4, X0 + 12)
      return
    }
    if (id === 'adx') {
      const a = adxArr(data, 14)
      const y25 = sy(25, 0, 100)
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, y25); ctx.lineTo(W, y25); ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = IND_COLORS.adx; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false
      for (let i = 0; i < count; i++) { if (a[i] == null) { st = false; continue } const x = px(i), y = sy(a[i]!, 0, 100); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true }
      ctx.stroke()
      ctx.fillText('ADX (14)  ' + (a[count - 1] != null ? a[count - 1]!.toFixed(1) : ''), 4, X0 + 12)
      return
    }
  }

  function drawIndicator() {
    const W = canvas!.clientWidth, H = canvas!.clientHeight
    if (!W || !H) return
    const s = state.series[state.active]
    if (!s || s.data.length < 5) return
    const data = chartData(), count = data.length, cw = W / count, [min, max] = priceRange(), range = max - min || 1
    const MH = mainChartH(H)
    const px = (i: number) => i * cw + cw / 2
    const py = (v: number) => MH - ((v - min) / range) * MH
    const closes = data.map((d) => d.c)
    for (const id of state.indicators) {
      if (!INDS[id]) continue
      if (!INDS[id].panel) drawOverlay(id, data, count, px, py, closes)
    }
    for (const pr of panelRects(H)) drawPanel(pr.id, pr, data, count, cw)
  }

  function renderLegend() {
    legendEl!.innerHTML = ''
    for (const id of state.indicators) {
      const name = IND_NAMES[id]
      if (!name) continue
      const chip = document.createElement('div')
      chip.className = 'stp-ind-chip'
      chip.title = 'Click to remove ' + name
      chip.innerHTML = `<span class="stp-ind-dot" style="background:${IND_COLORS[id]}"></span><span>${name}</span><span class="stp-ind-x">×</span>`
      chip.onclick = () => { state.indicators = state.indicators.filter((x) => x !== id); renderLegend(); renderAll() }
      legendEl!.appendChild(chip)
    }
  }

  function updateHeader() {
    const def = MARKET_DEFS[state.active]
    const s = state.series[state.active]
    if (!def || !s || !s.data.length) return
    const dp = def.dp
    const first = s.data[0], last = s.data[s.data.length - 1]
    const chg = ((last.c - first.o) / first.o) * 100
    const col = chg >= 0 ? '#00c076' : '#f6465d'
    priceEl!.style.color = col
    changeEl!.style.color = col
    changeEl!.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'
    symEl!.textContent = state.active
    badgeMarketEl!.textContent = def.cat + ' · ' + def.name
    const pats = candlestickPatterns(chartData())
    badgeTfEl!.textContent = state.tfLabel + (pats.length ? ' · ' + pats[0] : '')
    priceEl!.textContent = formatPrice(last.c, dp)
  }

  function updateDropdown() {
    if (dropdownBtn && state.active) dropdownBtn.textContent = state.active + ' ▼'
    dropdownMenu!.querySelectorAll<HTMLDivElement>('.stp-market-dropdown-item').forEach((item) => {
      const sym = item.dataset.sym!, s = state.series[sym]
      item.classList.toggle('active', sym === state.active)
      if (!s || !s.data.length) return
      const def = MARKET_DEFS[sym], dp = def.dp, first = s.data[0], last = s.data[s.data.length - 1]
      const chg = ((last.c - first.o) / first.o) * 100
      const priceItemEl = item.querySelector<HTMLElement>('.stp-mdd-price'), pctEl = item.querySelector<HTMLElement>('.stp-mdd-pct')
      if (priceItemEl) priceItemEl.textContent = formatPrice(last.c, dp)
      if (pctEl) pctEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'
      const col = chg >= 0 ? '#00c076' : '#f6465d'
      if (priceItemEl) priceItemEl.style.color = col
      if (pctEl) pctEl.style.color = col
    })
  }

  function closeWS() {
    if (ws) { try { ws.onclose = null; ws.close() } catch { /* ignore */ } ws = null }
  }
  function openWS() {
    const def = MARKET_DEFS[state.active]
    if (!def) return
    if (wsActive === state.active && wsTF === state.tfLabel) return
    closeWS()
    wsActive = state.active; wsTF = state.tfLabel
    const stream = state.active.replace('/USDT', 'USDT').toLowerCase() + '@kline_' + BINANCE_TF[state.tfLabel]
    try {
      ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + stream)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (!msg || !msg.data || !msg.data.k) return
          const k = msg.data.k, sym = state.active, s = state.series[sym]
          if (!s) return
          const c: Candle = { o: +k.o, h: +k.h, l: +k.l, c: +k.c, t: +k.t, v: +k.v }
          const last = s.data[s.data.length - 1]
          if (!last || c.t > last.t) { s.data.push(c); if (s.data.length > 220) s.data.shift() }
          else if (c.t === last.t) { last.o = c.o; last.h = c.h; last.l = c.l; last.c = c.c; last.v = c.v }
          s.price = c.c; s.anchor = c.c
        } catch { /* ignore malformed frame */ }
      }
      ws.onclose = () => {
        if (wsActive === state.active) {
          const id = window.setTimeout(() => { if (wsActive === state.active) openWS() }, 3000)
          intervalIds.push(id)
        }
      }
      ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
    } catch {
      closeWS(); wsActive = ''
    }
  }

  async function refreshBinanceAll() {
    if (destroyed) return
    for (const sym of Object.keys(MARKET_DEFS)) {
      if (sym === wsActive) continue
      try {
        const candles = await loadBinance(sym, state.tfLabel)
        if (candles && candles.length > 2) {
          const s = state.series[sym]
          if (s) { s.data = candles.slice(-220); s.price = candles[candles.length - 1].c; s.anchor = s.price }
          else { const ns: SeriesState = { data: candles, price: candles[candles.length - 1].c, live: true }; ns.anchor = ns.price; state.series[sym] = ns }
        }
      } catch { /* ignore — next 20s cycle retries */ }
    }
    if (!destroyed) renderAll()
  }

  async function refreshTradingView() {
    if (destroyed) return
    try {
      const res = await fetch('https://scanner.tradingview.com/crypto/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: { tickers: Object.values(TV_TICKERS), query: { types: [] } },
          columns: ['name', 'close', 'change', 'high', 'low'],
        }),
      })
      const json = await res.json()
      if (!json || !json.data) return
      json.data.forEach((row: { s: string; d: number[] }) => {
        const sym = Object.keys(TV_TICKERS).find((s) => TV_TICKERS[s] === row.s)
        if (!sym) return
        const s = state.series[sym]
        if (!s || !s.data.length) return
        const tvClose = +row.d[1]
        if (!isFinite(tvClose) || tvClose <= 0) return
        const last = s.data[s.data.length - 1]
        s.anchor = tvClose; s.tvPrice = tvClose
        last.c = tvClose
        if (tvClose > last.h) last.h = tvClose
        if (tvClose < last.l) last.l = tvClose
        s.price = tvClose
      })
    } catch { /* ignore — cosmetic nudge only, next 6s cycle retries */ }
  }

  function pulseLive() {
    Object.keys(MARKET_DEFS).forEach((sym) => {
      const s = state.series[sym]
      if (!s || !s.live || !s.data.length) return
      if (typeof s.noise !== 'number') s.noise = 0
      const anchor = typeof s.anchor === 'number' ? s.anchor : s.price
      s.noise = s.noise * 0.9 + (Math.random() - 0.497) * 0.0003
      const last = s.data[s.data.length - 1]
      last.c = anchor * (1 + s.noise)
      last.h = Math.max(last.h, last.c); last.l = Math.min(last.l, last.c)
      s.price = last.c
    })
  }

  function renderAll() {
    renderChart(); drawIndicator(); renderLegend(); updateHeader()
  }

  function selectSymbol(sym: string) {
    state.active = sym
    updateDropdown()
    openWS()
    renderAll()
  }

  function buildDropdown() {
    dropdownMenu!.innerHTML = ''
    CRYPTO_ORDER.forEach((sym) => {
      const def = MARKET_DEFS[sym]
      if (!def) return
      const item = document.createElement('div')
      item.className = 'stp-market-dropdown-item'
      item.dataset.sym = sym
      item.innerHTML = `<div><div class="stp-mdd-sym">${sym}</div></div><div class="stp-mdd-right"><div class="stp-mdd-price">—</div><div class="stp-mdd-pct">—</div></div>`
      item.onclick = () => {
        selectSymbol(sym)
        closeDropdown()
        options.onSymbolChange?.(sym)
      }
      dropdownMenu!.appendChild(item)
    })
    updateDropdown()
  }
  function toggleDropdown(e: Event) {
    e.stopPropagation()
    dropdownMenu!.classList.toggle('show')
  }
  function closeDropdown() {
    dropdownMenu!.classList.remove('show')
  }
  function handleDocClick(e: MouseEvent) {
    if (dropdownRoot && !dropdownRoot.contains(e.target as Node)) closeDropdown()
  }

  function crosshairMove(e: MouseEvent) {
    const rect = canvas!.getBoundingClientRect(), W = canvas!.clientWidth, H = canvas!.clientHeight
    const x = e.clientX - rect.left, y = e.clientY - rect.top, s = state.series[state.active]
    if (!s || !s.data.length) return
    const data = chartData()
    const count = data.length, cw = W / count
    const idx = Math.min(count - 1, Math.max(0, Math.floor(x / cw))), d = data[idx], cx = candleX(idx, count, W)
    renderChart(); drawIndicator()
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(cx - cw / 2, 0, cw, H)
    const dp = MARKET_DEFS[state.active].dp
    const f = (v: number) => formatPrice(v, dp)
    tip.style.display = 'block'
    tip.style.left = (x + 14 < W ? x + 14 : x - 150) + 'px'
    tip.style.top = (y + 14 < H ? y + 14 : y - 90) + 'px'
    tip.innerHTML = `<div><b>Time:</b> ${new Date(d.t).toLocaleTimeString()}</div><div><b>O:</b> ${f(d.o)}</div><div><b>H:</b> ${f(d.h)}</div><div><b>L:</b> ${f(d.l)}</div><div><b>C:</b> <span style="color:${d.c >= d.o ? '#00c076' : '#f6465d'}">${f(d.c)}</span></div>`
  }
  function crosshairLeave() {
    tip.style.display = 'none'
    renderChart(); drawIndicator()
  }

  function tfButtonsInit() {
    tfTabs.forEach((b) => {
      b.onclick = () => {
        tfTabs.forEach((x) => x.classList.remove('active'))
        b.classList.add('active')
        state.tf = TIMEFRAMES[b.dataset.tf!]; state.tfLabel = b.dataset.tf!
        for (const sym of Object.keys(MARKET_DEFS)) {
          delete state.series[sym]
          loadLiveInitial(sym).then(() => renderAll())
        }
        openWS()
        renderAll()
      }
    })
  }

  function resizeHandler() { renderChart() }

  // ---- init ----
  buildDropdown()
  tfButtonsInit()
  function handleIndicatorChange() {
    const v = indicatorSelect.value
    indicatorSelect.value = ''
    if (!v || /^vol\d*$/.test(v)) return
    if (v === 'clear') state.indicators = []
    else if (!state.indicators.includes(v)) state.indicators.push(v)
    renderAll()
  }
  indicatorSelect.addEventListener('change', handleIndicatorChange)
  canvas.addEventListener('mousemove', crosshairMove)
  canvas.addEventListener('mouseleave', crosshairLeave)
  dropdownBtn.addEventListener('click', toggleDropdown)
  window.addEventListener('resize', resizeHandler)
  document.addEventListener('click', handleDocClick)

  Promise.all(Object.keys(MARKET_DEFS).map((sym) => loadLiveInitial(sym).catch(() => false))).then(() => {
    if (destroyed) return
    openWS()
    renderAll()
  })

  intervalIds.push(window.setInterval(refreshBinanceAll, 20000))
  intervalIds.push(window.setInterval(refreshTradingView, 6000))
  intervalIds.push(
    window.setInterval(() => {
      for (const sym of Object.keys(MARKET_DEFS)) tick(sym)
      pulseLive()
      renderChart(); drawIndicator(); updateHeader(); updateDropdown()
    }, 600),
  )

  return {
    setSymbol(pair: string) {
      if (!MARKET_DEFS[pair] || pair === state.active) return
      selectSymbol(pair)
    },
    destroy() {
      destroyed = true
      intervalIds.forEach((id) => { clearInterval(id); clearTimeout(id) })
      closeWS()
      window.removeEventListener('resize', resizeHandler)
      document.removeEventListener('click', handleDocClick)
      canvas.removeEventListener('mousemove', crosshairMove)
      canvas.removeEventListener('mouseleave', crosshairLeave)
      dropdownBtn.removeEventListener('click', toggleDropdown)
      indicatorSelect.removeEventListener('change', handleIndicatorChange)
    },
  }
}
