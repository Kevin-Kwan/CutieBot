/**
 * Shop catalog + pure shop math.
 *
 * Parity source: the old bot's `modules/inventory_funcs.js` (`shop_items`)
 * and `economy/inventory.js` / `economy/shop.js` (sell price). The catalog is
 * typed data here — the old code scattered it through a data-layer module
 * and shadowed the global `Math` with mathjs to compute the sell price.
 */

export interface ShopItem {
  readonly id: number;
  readonly name: string;
  readonly cost: number;
  readonly info: string;
}

/** The catalog, verbatim from the old `shop_items` (inventory_funcs.js:9-13). */
export const SHOP_ITEMS: readonly ShopItem[] = [
  { name: 'watch', cost: 100, id: 1, info: "It's a watch" },
  { name: 'mobile', cost: 1000, id: 2, info: "It's a mobile" },
  { name: 'laptop', cost: 10000, id: 3, info: "It's a laptop" },
];

/** Sell-back ratio: the old code sold at `Math.round(cost / 4)`. */
export const SELL_DIVISOR = 4;

export function buyPrice(item: ShopItem): number {
  return item.cost;
}

/** Sell price = round(cost / 4) — verified in old shop.js:31 and inventory.js:110. */
export function sellPrice(item: ShopItem): number {
  return Math.round(item.cost / SELL_DIVISOR);
}

export function canAfford(balance: number, item: ShopItem): boolean {
  return balance >= buyPrice(item);
}

/**
 * Find a catalog item by name (case-insensitive, trimmed — the old buy/sell
 * commands matched on lowercased name) or by its numeric id as a string.
 */
export function findItem(query: string): ShopItem | undefined {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return undefined;
  return SHOP_ITEMS.find(
    (item) => item.name.toLowerCase() === normalized || String(item.id) === normalized,
  );
}

export function itemById(id: number): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}
