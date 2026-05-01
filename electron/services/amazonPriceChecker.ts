import { BrowserWindow, session } from 'electron'

// ============================================================================
// Types
// ============================================================================

export type ListingSource = 'amazon' | 'yami' | 'costco' | 'unknown'

export interface PriceCheckResult {
  sku: string
  ebayListingId: string
  listingSource: ListingSource
  // Source-side data
  sourceId: string | null          // ASIN for amazon, item ID for yami/costco
  sourcePrice: number | null
  sourceTitle: string | null
  sourceUrl: string | null
  isAvailable: boolean
  // eBay side
  ebayPrice: number
  multiplier: number | null
  // How we found it
  method: 'direct' | 'search' | 'not_checkable' | 'error'
  error?: string
  checkedAt: string
}

// Keep old name as alias so existing callers don't break
export type AmazonPriceResult = PriceCheckResult

export interface PriceCheckBatch {
  results: PriceCheckResult[]
  totalChecked: number
  checkableListings: number
  needsAttention: number
  cachedCount?: number
}

export interface PriceCheckProgress {
  current: number
  total: number
  sku: string
  status: string
}

// ============================================================================
// Source detection
// ============================================================================

export function detectSource(sku: string): ListingSource {
  if (!sku) return 'unknown'
  const s = sku.trim()
  // Amazon: AMZN-B0DB2RG98R  or  B01E0PQUD6
  if (/^AMZN-[A-Z0-9]{10}$/i.test(s)) return 'amazon'
  if (/^B[0-9A-Z]{9}$/.test(s.toUpperCase())) return 'amazon'
  // Yami: all-digit, starts with 1 or 5  (e.g. 1023332621, 5023332621)
  if (/^[15]\d{7,11}$/.test(s)) return 'yami'
  // Costco: all-digit, starts with 4  (e.g. 4000214814)
  if (/^4\d{7,11}$/.test(s)) return 'costco'
  return 'unknown'
}

export function extractAsinFromSku(sku: string): string | null {
  if (!sku) return null
  const prefixMatch = sku.match(/^AMZN-([A-Z0-9]{10})$/i)
  if (prefixMatch) return prefixMatch[1].toUpperCase()
  const trimmed = sku.trim().toUpperCase()
  if (/^B[0-9A-Z]{9}$/.test(trimmed)) return trimmed
  return null
}

// ============================================================================
// AI best-match helper
// ============================================================================

let aiApiKey: string | null = null

export function setAiApiKey(key: string): void {
  aiApiKey = key || null
}

interface AiCandidate {
  asin: string
  title: string | null
  price: string | null
  imageUrl: string | null
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } }

async function findBestMatchWithAI(
  ebayTitle: string,
  ebayImageUrl: string | null,
  candidates: AiCandidate[],
): Promise<number | null> {
  if (!aiApiKey || candidates.length === 0) return null
  if (candidates.length === 1) return 0

  try {
    const content: ContentBlock[] = []

    content.push({
      type: 'text',
      text: `I need to find which Amazon product best matches this eBay listing.\n\neBay listing title: "${ebayTitle}"\n`,
    })

    if (ebayImageUrl) {
      content.push({ type: 'text', text: 'eBay listing image:' })
      content.push({ type: 'image', source: { type: 'url', url: ebayImageUrl } })
    }

    content.push({ type: 'text', text: '\nAmazon search candidates:' })

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      content.push({
        type: 'text',
        text: `\nCandidate ${i + 1} (ASIN: ${c.asin})\nTitle: ${c.title ?? 'Unknown'}\nPrice: ${c.price ?? 'Unknown'}`,
      })
      if (c.imageUrl) {
        try {
          content.push({ type: 'image', source: { type: 'url', url: c.imageUrl } })
        } catch { /* skip image if invalid */ }
      }
    }

    content.push({
      type: 'text',
      text: `\nWhich candidate number (1–${candidates.length}) is the closest match to the eBay listing in terms of product type, function, size, and quantity? Reply with just the number.`,
    })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!response.ok) return null
    const data = await response.json() as { content: Array<{ type: string; text: string }> }
    const text = data.content?.[0]?.text?.trim()
    const num = parseInt(text ?? '', 10)
    if (isNaN(num) || num < 1 || num > candidates.length) return null
    return num - 1
  } catch {
    return null
  }
}

// ============================================================================
// Utilities
// ============================================================================

const AMAZON_SESSION_PARTITION = 'persist:amazon-checker'
const PAGE_LOAD_TIMEOUT = 25000
const POOL_SIZE = 3           // concurrent scraper windows (3 avoids aggressive rate limiting)
const STAGGER_DELAY = 800     // ms between each worker's first request start
const INTER_REQUEST_DELAY = 1200  // ms delay within each worker after completing a check

function parsePrice(priceStr: string | null): number | null {
  if (!priceStr) return null
  const match = priceStr.match(/[\d,]+\.?\d*/)
  if (!match) return null
  return parseFloat(match[0].replace(/,/g, ''))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const scraperPool: (BrowserWindow | null)[] = new Array(POOL_SIZE).fill(null)
let abortFlag = false

function getOrCreateScraperWindow(slot = 0): BrowserWindow {
  if (scraperPool[slot] && !scraperPool[slot]!.isDestroyed()) return scraperPool[slot]!
  const ses = session.fromPartition(AMAZON_SESSION_PARTITION)
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
  })
  win.on('closed', () => { scraperPool[slot] = null })
  scraperPool[slot] = win
  return win
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function loadAndExtract<T>(
  win: BrowserWindow,
  url: string,
  extractScript: string,
  settle = 1200,
  timeoutMs = PAGE_LOAD_TIMEOUT
): Promise<T> {
  if (win.isDestroyed()) throw new Error('Scraper window has been closed')

  return new Promise<T>((resolve, reject) => {
    const safeReject = (err: Error) => {
      clearTimeout(timer)
      if (!win.isDestroyed()) {
        win.webContents.removeAllListeners('did-finish-load')
        win.webContents.removeAllListeners('did-fail-load')
      }
      reject(err)
    }

    const timer = setTimeout(() => {
      safeReject(new Error(`Page load timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    win.webContents.once('did-finish-load', async () => {
      clearTimeout(timer)
      try {
        await delay(settle)
        if (win.isDestroyed()) { reject(new Error('Window closed during settle')); return }
        const result = await win.webContents.executeJavaScript(extractScript)
        resolve(result as T)
      } catch (err) {
        reject(err)
      }
    })

    win.webContents.once('did-fail-load', (_e, _code, desc) => {
      safeReject(new Error(`Page failed to load: ${desc}`))
    })

    win.webContents.loadURL(url, { userAgent: CHROME_UA }).catch((err) => safeReject(err as Error))
  })
}

// ============================================================================
// Amazon scraping
// ============================================================================

// Selector hierarchy calibrated from live diagnostic on B0DLXQVNWP:
//   Strategy 0: #corePrice_feature_div [class*="apex-pricetopay-"] .a-offscreen → "$9.99" direct
//   Strategy 1: .priceToPay .a-price-whole + fraction construction
//   Strategy 2: .priceToPay .a-offscreen (often empty but worth trying)
//   Strategy 3: #apex_offerDisplay_desktop, skip per-unit elements
//   Strategy 4: legacy #priceblock_ourprice etc.
//
// Explicitly excluded: .basisPrice (original price), #sns-base-price (S&S price),
//   bare .a-offscreen scan (picks up unit/original prices)
const AMAZON_PRODUCT_EXTRACT = `
(function() {
  const isCaptcha =
    document.title.toLowerCase().includes('robot') ||
    !!document.querySelector('form[action*="validateCaptcha"]') ||
    document.title.toLowerCase().includes('captcha');
  if (isCaptcha) return { isCaptcha: true, isNotFound: false, price: null, title: null, isAvailable: false };

  // Detect "sorry, page not found" — ASIN has been removed from Amazon catalog
  const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
  const titleText = document.title.toLowerCase();
  const isNotFound =
    titleText.includes('page not found') ||
    titleText.includes("sorry! we couldn't find") ||
    bodyText.includes("we couldn't find that page") ||
    bodyText.includes("the page you're looking for isn't here") ||
    !!document.querySelector('[class*="page-not-found"]') ||
    !!document.querySelector('#g .a-size-large') && !document.querySelector('#dp');
  if (isNotFound) return { isCaptcha: false, isNotFound: true, price: null, title: null, isAvailable: false };

  const PRICE_RE = /^\\\$[\\d,]+\\.\\d{2}$/;

  const firstOffscreen = (container, skipSel) => {
    if (!container) return null;
    for (const el of container.querySelectorAll('.a-offscreen')) {
      if (skipSel && el.closest(skipSel)) continue;
      const t = el.textContent.trim();
      if (PRICE_RE.test(t)) return t;
    }
    return null;
  };

  const buildFromParts = (container) => {
    if (!container) return null;
    const whole = container.querySelector('.priceToPay .a-price-whole');
    const frac  = container.querySelector('.priceToPay .a-price-fraction');
    if (!whole) return null;
    const w = whole.textContent.replace(/[^0-9]/g, '');
    const f = frac ? frac.textContent.replace(/[^0-9]/g, '').substring(0,2).padEnd(2,'0') : '00';
    if (!w) return null;
    const c = '$' + w + '.' + f;
    return PRICE_RE.test(c) ? c : null;
  };

  let price = null;

  // 0. #corePrice_feature_div apex-pricetopay element (modern buybox)
  if (!price) {
    const cpf = document.querySelector('#corePrice_feature_div');
    if (cpf) {
      const apex = cpf.querySelector('[class*="apex-pricetopay-"]');
      if (apex) price = firstOffscreen(apex, null);
    }
  }
  // 1. .priceToPay whole+fraction
  if (!price) price = buildFromParts(document.querySelector('#corePriceDisplay_desktop_feature_div'));
  // 2. .priceToPay .a-offscreen
  if (!price) {
    const core = document.querySelector('#corePriceDisplay_desktop_feature_div');
    if (core) {
      const pp = core.querySelector('.priceToPay .a-offscreen');
      if (pp) { const t = pp.textContent.trim(); if (PRICE_RE.test(t)) price = t; }
    }
  }
  // 3. apex offer display, skip per-unit prices
  if (!price) price = firstOffscreen(document.querySelector('#apex_offerDisplay_desktop'), '[class*="priceperunit"]');
  // 4. legacy
  if (!price) {
    for (const sel of ['#priceblock_ourprice','#priceblock_dealprice','#price_inside_buybox']) {
      const el = document.querySelector(sel);
      if (el) { const t = el.textContent.trim(); if (PRICE_RE.test(t)) { price = t; break; } }
    }
  }

  // Availability: add-to-cart is most reliable; #availability text is secondary
  const addToCart = document.querySelector('#add-to-cart-button');
  const buyNow    = document.querySelector('#buy-now-button');
  let isAvailable = !!(addToCart || buyNow);
  if (!isAvailable) {
    const availEl = document.querySelector('#availability span');
    if (availEl) {
      const text = availEl.textContent.substring(0, 60).toLowerCase().trim();
      isAvailable = text.includes('in stock') || text.includes('left in stock') || text.includes('order soon');
    }
  }

  const titleEl = document.querySelector('#productTitle');
  return { isCaptcha: false, isNotFound: false, price, title: titleEl ? titleEl.textContent.trim() : null, isAvailable };
})()
`

const AMAZON_SEARCH_EXTRACT = `
(function() {
  const isCaptcha =
    document.title.toLowerCase().includes('robot') ||
    !!document.querySelector('form[action*="validateCaptcha"]');
  if (isCaptcha) return { isCaptcha: true, results: [] };

  const results = [];
  document.querySelectorAll('[data-asin][data-component-type="s-search-result"]').forEach(item => {
    if (results.length >= 5) return;
    const asin = item.getAttribute('data-asin');
    if (!asin || asin.length < 5) return;
    const titleEl = item.querySelector('h2 a span, h2 span, .a-text-normal');
    const priceEl = item.querySelector('.a-price .a-offscreen');
    const imageEl = item.querySelector('img.s-image');
    results.push({
      asin,
      title: titleEl ? titleEl.textContent.trim() : null,
      price: priceEl ? priceEl.textContent.trim() : null,
      isAvailable: !item.querySelector('.s-unavailable-item'),
      imageUrl: imageEl ? imageEl.getAttribute('src') : null,
    });
  });
  return { isCaptcha: false, results };
})()
`

async function checkAmazon(
  sku: string,
  listingId: string,
  ebayTitle: string,
  ebayPrice: number,
  ebayImageUrl?: string | null,
  onStatus?: (s: string) => void,
  win?: BrowserWindow
): Promise<PriceCheckResult> {
  const base: PriceCheckResult = {
    sku, ebayListingId: listingId, listingSource: 'amazon',
    sourceId: null, sourcePrice: null, sourceTitle: null, sourceUrl: null,
    isAvailable: false, ebayPrice, multiplier: null,
    method: 'not_checkable', checkedAt: new Date().toISOString(),
  }

  const asin = extractAsinFromSku(sku)
  if (!asin) return base
  base.sourceId = asin

  if (!win) win = getOrCreateScraperWindow(0)

  type DirectExtract = { isCaptcha: boolean; isNotFound: boolean; price: string | null; title: string | null; isAvailable: boolean }
  type SearchExtract = { isCaptcha: boolean; results: Array<{ asin: string; title: string | null; price: string | null; isAvailable: boolean; imageUrl: string | null }> }

  const directUrl = `https://www.amazon.com/dp/${asin}`

  // --- Step 1: Try the direct product page ---
  let directData: DirectExtract | null = null
  try {
    onStatus?.(`Loading amazon.com/dp/${asin}`)
    directData = await loadAndExtract<DirectExtract>(win, directUrl, AMAZON_PRODUCT_EXTRACT)
  } catch (_) { /* network/timeout — fall through */ }

  if (directData?.isCaptcha) {
    return { ...base, sourceUrl: directUrl, method: 'error', error: 'Amazon CAPTCHA — open Amazon Login to solve it' }
  }

  // --- Step 2: ASIN is gone from Amazon (page not found) ---
  // Mark unavailable. Search for a similar item using AI image+text matching for reference.
  // We do NOT calculate a multiplier from a different item's price.
  if (directData?.isNotFound) {
    onStatus?.('ASIN gone — searching similar item (reference only)')
    try {
      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(ebayTitle.substring(0, 120))}`
      const { isCaptcha, results } = await loadAndExtract<SearchExtract>(win, searchUrl, AMAZON_SEARCH_EXTRACT)
      if (!isCaptcha && results.length > 0) {
        // Use AI to pick the best match by image + title comparison
        const candidates = results.filter(r => r.asin !== asin)
        let bestIdx: number | null = null
        if (candidates.length > 0) {
          onStatus?.('AI matching similar item…')
          bestIdx = await findBestMatchWithAI(ebayTitle, ebayImageUrl ?? null, candidates)
        }
        const similar = bestIdx !== null ? candidates[bestIdx] : (candidates.find(r => r.price) ?? results.find(r => r.price))
        if (similar) {
          const p = parsePrice(similar.price ?? null)
          return {
            ...base,
            sourceId: similar.asin,
            sourcePrice: p,
            sourceTitle: similar.title,
            sourceUrl: `https://www.amazon.com/dp/${similar.asin}`,
            isAvailable: false,   // original ASIN gone → unavailable
            multiplier: null,     // different item — multiplier would be misleading
            method: 'search',
            error: 'Original ASIN not on Amazon (similar item shown for reference)',
          }
        }
      }
    } catch (_) { /* ignore */ }
    return { ...base, sourceUrl: directUrl, isAvailable: false, method: 'direct', error: 'ASIN not found on Amazon' }
  }

  // --- Step 3: Page loaded, price found — normal path ---
  if (directData?.price) {
    const p = parsePrice(directData.price)
    return {
      ...base,
      sourcePrice: p,
      sourceTitle: directData.title,
      sourceUrl: directUrl,
      isAvailable: directData.isAvailable,
      multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null,
      method: 'direct',
    }
  }

  // --- Step 4: Page loaded but no price (e.g. no buy box) ---
  // Search as price-finding fallback. Only use the result if the exact ASIN appears in search
  // (meaning the item still exists but just has no buy box on its own page).
  try {
    onStatus?.('No price found — searching for exact ASIN in results')
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(ebayTitle.substring(0, 120))}`
    const { isCaptcha, results } = await loadAndExtract<SearchExtract>(win, searchUrl, AMAZON_SEARCH_EXTRACT)
    if (isCaptcha) return { ...base, sourceUrl: directUrl, method: 'error', error: 'Amazon CAPTCHA — try again later' }
    const exactMatch = results.find(r => r.asin === asin)
    if (exactMatch) {
      const p = parsePrice(exactMatch.price ?? null)
      return {
        ...base,
        sourcePrice: p,
        sourceTitle: exactMatch.title,
        sourceUrl: directUrl,
        isAvailable: exactMatch.isAvailable,
        multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null,
        method: 'search',
      }
    }
    // ASIN not in search results → effectively gone
    return { ...base, sourceUrl: directUrl, isAvailable: false, method: 'direct', error: 'No price and ASIN absent from search results' }
  } catch (err) {
    return { ...base, method: 'error', error: (err as Error).message }
  }
}

// ============================================================================
// Yami scraping  (yami.com)
// ============================================================================

// Yami product page selectors — calibrate with the diagnostic script if prices are wrong.
// Direct URL: https://www.yami.com/item/{sku}/1/detail
const YAMI_PRODUCT_EXTRACT = `
(function() {
  const title = (
    document.querySelector('h1.pdp-name, h1.product-name, .item-title h1, .goods-name')
    || document.querySelector('h1')
  )?.textContent?.trim() || null;

  // Try common price selectors used by yami.com
  const priceSelectors = [
    '.pdp-price .price',
    '.sale-price',
    '.now-price',
    '.current-price',
    '[class*="price"] [class*="value"]',
    '[class*="Price"] [class*="amount"]',
    '.item-price',
    '.product-price',
  ];

  let priceText = null;
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.textContent.trim();
      if (t && /[\\d]/.test(t)) { priceText = t; break; }
    }
  }

  // Fallback: any element whose text looks like a USD price
  if (!priceText) {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 0) continue; // leaf nodes only
      const t = el.textContent.trim();
      if (/^\\\$[\\d,]+\\.\\d{2}$/.test(t)) { priceText = t; break; }
    }
  }

  // Availability: add-to-cart button or "out of stock" text
  const cartBtn = document.querySelector('[class*="add-to-cart"], [class*="addToCart"], button[type="submit"]');
  const outOfStock = !!document.querySelector('[class*="out-of-stock"], [class*="outOfStock"], [class*="sold-out"]');
  const isAvailable = !outOfStock && !!cartBtn;

  return { title, priceText, isAvailable, url: location.href };
})()
`

const YAMI_SEARCH_EXTRACT = `
(function() {
  const results = [];
  // Yami search result cards
  const cards = document.querySelectorAll('[class*="product-card"], [class*="goods-item"], [class*="item-card"]');
  cards.forEach(card => {
    if (results.length >= 5) return;
    const titleEl = card.querySelector('[class*="name"], [class*="title"]');
    const priceEl = card.querySelector('[class*="price"]');
    const linkEl  = card.querySelector('a[href*="/item/"]');
    const itemIdMatch = linkEl?.getAttribute('href')?.match(/\\/item\\/(\\d+)/);
    if (!itemIdMatch) return;
    results.push({
      itemId: itemIdMatch[1],
      title: titleEl?.textContent?.trim() || null,
      price: priceEl?.textContent?.trim() || null,
      url: 'https://www.yami.com' + linkEl.getAttribute('href'),
    });
  });
  return { results };
})()
`

async function checkYami(
  sku: string,
  listingId: string,
  ebayTitle: string,
  ebayPrice: number,
  onStatus?: (s: string) => void,
  win?: BrowserWindow
): Promise<PriceCheckResult> {
  const base: PriceCheckResult = {
    sku, ebayListingId: listingId, listingSource: 'yami',
    sourceId: sku, sourcePrice: null, sourceTitle: null, sourceUrl: null,
    isAvailable: false, ebayPrice, multiplier: null,
    method: 'not_checkable', checkedAt: new Date().toISOString(),
  }

  if (!win) win = getOrCreateScraperWindow(0)

  // Direct URL
  try {
    const url = `https://www.yami.com/item/${sku}/1/detail`
    onStatus?.(`Loading yami.com/item/${sku}`)
    const data = await loadAndExtract<{ title: string | null; priceText: string | null; isAvailable: boolean; url: string }>(win, url, YAMI_PRODUCT_EXTRACT, 1500)
    if (data.priceText) {
      const p = parsePrice(data.priceText)
      return { ...base, sourcePrice: p, sourceTitle: data.title, sourceUrl: url, isAvailable: data.isAvailable, multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null, method: 'direct' }
    }
  } catch (_) { /* fall through */ }

  // Search fallback
  try {
    onStatus?.('Searching Yami by title')
    const searchUrl = `https://www.yami.com/search/?q=${encodeURIComponent(ebayTitle.substring(0, 80))}`
    const { results } = await loadAndExtract<{ results: Array<{ itemId: string; title: string | null; price: string | null; url: string }> }>(win, searchUrl, YAMI_SEARCH_EXTRACT, 1500)
    const exactMatch = results.find(r => r.itemId === sku)
    const target = exactMatch || results.find(r => r.price)
    if (target) {
      const p = parsePrice(target.price ?? null)
      return { ...base, sourceId: target.itemId, sourcePrice: p, sourceTitle: target.title, sourceUrl: target.url, isAvailable: !!target.price, multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null, method: target.itemId === sku ? 'direct' : 'search' }
    }
  } catch (err) {
    return { ...base, method: 'error', error: (err as Error).message }
  }

  return { ...base, method: 'error', error: 'Product not found on Yami' }
}

// ============================================================================
// Costco scraping  (costco.com)
// ============================================================================

// Costco item SKUs (e.g. 4000214814) are internal IDs — not direct Costco item numbers.
// We search costco.com by title. Calibrate with the diagnostic script if needed.
const COSTCO_SEARCH_EXTRACT = `
(function() {
  const results = [];
  // Costco search result cards
  const cards = document.querySelectorAll('.product, [class*="product-tile"], [automation-id*="productTile"]');
  cards.forEach(card => {
    if (results.length >= 5) return;
    const titleEl = card.querySelector('.description a, .product-title a, h2 a, h3 a');
    const priceEl = card.querySelector('.price, .your-price .value, [automation-id*="productPrice"], [class*="price-current"]');
    const linkEl  = titleEl || card.querySelector('a[href*="costco.com"]');
    if (!linkEl) return;
    results.push({
      title: titleEl?.textContent?.trim() || null,
      price: priceEl?.textContent?.trim() || null,
      url:   linkEl?.getAttribute('href') || null,
    });
  });
  return { results };
})()
`

const COSTCO_PRODUCT_EXTRACT = `
(function() {
  const title = document.querySelector('h1.product-title, h1[itemprop="name"], #product-details h1')?.textContent?.trim() || null;

  const priceSelectors = [
    '.your-price .value',
    '#add-to-cart-pane .price',
    '[automation-id="buyBoxProductPrice"]',
    '.price-current',
    '.product-price',
    '[itemprop="price"]',
  ];

  let priceText = null;
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.textContent.trim();
      if (t && /[\\d]/.test(t)) { priceText = t; break; }
    }
  }

  const addToCart = !!document.querySelector('#add-to-cart-button, [automation-id="addToCartBtn"], .add-to-cart');
  const outOfStock = !!document.querySelector('.out-of-stock, [class*="outOfStock"]');
  const isAvailable = addToCart && !outOfStock;

  return { title, priceText, isAvailable, url: location.href };
})()
`

async function checkCostco(
  sku: string,
  listingId: string,
  ebayTitle: string,
  ebayPrice: number,
  onStatus?: (s: string) => void,
  win?: BrowserWindow
): Promise<PriceCheckResult> {
  const base: PriceCheckResult = {
    sku, ebayListingId: listingId, listingSource: 'costco',
    sourceId: sku, sourcePrice: null, sourceTitle: null, sourceUrl: null,
    isAvailable: false, ebayPrice, multiplier: null,
    method: 'not_checkable', checkedAt: new Date().toISOString(),
  }

  if (!win) win = getOrCreateScraperWindow(0)

  // Search by title (Costco SKUs in our system are not direct Costco item numbers)
  try {
    onStatus?.('Searching Costco by title')
    const searchUrl = `https://www.costco.com/Search?keyword=${encodeURIComponent(ebayTitle.substring(0, 80))}`
    const { results } = await loadAndExtract<{ results: Array<{ title: string | null; price: string | null; url: string | null }> }>(win, searchUrl, COSTCO_SEARCH_EXTRACT, 2000)
    const target = results.find(r => r.price)
    if (target?.url) {
      // Load the product page for accurate price + availability
      try {
        onStatus?.('Loading Costco product page')
        const productUrl = target.url.startsWith('http') ? target.url : `https://www.costco.com${target.url}`
        const product = await loadAndExtract<{ title: string | null; priceText: string | null; isAvailable: boolean; url: string }>(win, productUrl, COSTCO_PRODUCT_EXTRACT, 2000)
        if (product.priceText) {
          const p = parsePrice(product.priceText)
          return { ...base, sourcePrice: p, sourceTitle: product.title || target.title, sourceUrl: productUrl, isAvailable: product.isAvailable, multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null, method: 'search' }
        }
      } catch (_) { /* fall through to search price */ }

      // Use price from search results directly
      const p = parsePrice(target.price ?? null)
      return { ...base, sourcePrice: p, sourceTitle: target.title, sourceUrl: target.url.startsWith('http') ? target.url : `https://www.costco.com${target.url}`, isAvailable: !!target.price, multiplier: p && ebayPrice ? +(ebayPrice / p).toFixed(2) : null, method: 'search' }
    }
  } catch (err) {
    return { ...base, method: 'error', error: (err as Error).message }
  }

  return { ...base, method: 'error', error: 'Product not found on Costco' }
}

// ============================================================================
// Main entry point
// ============================================================================

export function isCheckable(sku: string): boolean {
  return detectSource(sku) !== 'unknown'
}

async function checkSingleListing(
  sku: string,
  listingId: string,
  ebayTitle: string,
  ebayPriceValue: string,
  ebayImageUrl?: string | null,
  onStatus?: (s: string) => void,
  win?: BrowserWindow
): Promise<PriceCheckResult> {
  const ebayPrice = parseFloat(ebayPriceValue) || 0
  const source = detectSource(sku)

  switch (source) {
    case 'amazon': return checkAmazon(sku, listingId, ebayTitle, ebayPrice, ebayImageUrl, onStatus, win)
    case 'yami':   return checkYami(sku, listingId, ebayTitle, ebayPrice, onStatus, win)
    case 'costco': return checkCostco(sku, listingId, ebayTitle, ebayPrice, onStatus, win)
    default:
      return {
        sku, ebayListingId: listingId, listingSource: 'unknown',
        sourceId: null, sourcePrice: null, sourceTitle: null, sourceUrl: null,
        isAvailable: false, ebayPrice, multiplier: null,
        method: 'not_checkable', checkedAt: new Date().toISOString(),
      }
  }
}

export async function checkListingPrices(
  listings: Array<{ sku: string; listingId: string; title: string; price: { value: string }; imageUrl?: string | null }>,
  onProgress?: (progress: PriceCheckProgress) => void,
  onResult?: (result: PriceCheckResult) => void
): Promise<PriceCheckBatch> {
  abortFlag = false
  const checkable = listings.filter(l => isCheckable(l.sku))
  const results: PriceCheckResult[] = new Array(checkable.length)
  let completed = 0
  let nextIndex = 0

  // Stagger worker starts so they don't all hit the same domain at the same instant.
  // Worker 0 starts immediately, worker 1 after STAGGER_DELAY, etc.
  // This spreads requests over POOL_SIZE * STAGGER_DELAY ms instead of all at once.
  const workers = Array.from({ length: Math.min(POOL_SIZE, checkable.length) }, async (_, workerSlot) => {
    if (workerSlot > 0) await delay(workerSlot * STAGGER_DELAY)

    while (!abortFlag) {
      const i = nextIndex++
      if (i >= checkable.length) break

      const listing = checkable[i]
      const win = getOrCreateScraperWindow(workerSlot)
      if (win.isDestroyed()) break  // window was closed (abort or crash) — stop this worker

      onProgress?.({ current: completed, total: checkable.length, sku: listing.sku, status: `[w${workerSlot + 1}] Checking...` })

      results[i] = await checkSingleListing(
        listing.sku,
        listing.listingId,
        listing.title,
        listing.price.value,
        listing.imageUrl ?? null,
        (status) => onProgress?.({ current: completed, total: checkable.length, sku: listing.sku, status: `[w${workerSlot + 1}] ${status}` }),
        win
      )

      completed++
      onResult?.(results[i])
      onProgress?.({ current: completed, total: checkable.length, sku: listing.sku, status: 'Done' })

      if (!abortFlag && nextIndex < checkable.length) {
        await delay(INTER_REQUEST_DELAY)
      }
    }
  })

  await Promise.all(workers)

  onProgress?.({ current: checkable.length, total: checkable.length, sku: '', status: 'Done' })

  const finalResults = results.filter(Boolean)
  return {
    results: finalResults,
    totalChecked: finalResults.length,
    checkableListings: checkable.length,
    needsAttention: finalResults.filter(r => r.multiplier !== null && r.multiplier < 2).length,
  }
}

// Keep old name for backward compatibility
export const checkAmazonPrices = checkListingPrices

export function abortPriceCheck(): void { abortFlag = true }

export function showAmazonLoginWindow(): void {
  const win = getOrCreateScraperWindow(0)
  win.show()
  win.webContents.loadURL('https://www.amazon.com/gp/sign-in.html', { userAgent: CHROME_UA })
}

export function closeScraperWindow(): void {
  for (let i = 0; i < scraperPool.length; i++) {
    const win = scraperPool[i]
    if (win && !win.isDestroyed()) win.close()
    scraperPool[i] = null
  }
}
