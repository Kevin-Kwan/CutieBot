import { describe, expect, it } from 'vitest';
import {
  SHOP_ITEMS,
  buyPrice,
  canAfford,
  findItem,
  itemById,
  sellPrice,
} from '../../../src/features/economy/shop.js';

describe('shop catalog (parity with old inventory_funcs.js shop_items)', () => {
  it('has exactly the three old items with their costs, ids, and info', () => {
    expect(SHOP_ITEMS).toEqual([
      { name: 'watch', cost: 100, id: 1, info: "It's a watch" },
      { name: 'mobile', cost: 1000, id: 2, info: "It's a mobile" },
      { name: 'laptop', cost: 10000, id: 3, info: "It's a laptop" },
    ]);
  });
});

describe('shop math', () => {
  it('buyPrice is the catalog cost', () => {
    for (const item of SHOP_ITEMS) expect(buyPrice(item)).toBe(item.cost);
  });

  it('sellPrice is round(cost / 4) — verified against the old shop.js/inventory.js', () => {
    const byId = (id: number) => {
      const item = itemById(id);
      if (item === undefined) throw new Error(`catalog item ${id} missing`);
      return item;
    };
    expect(sellPrice(byId(1))).toBe(25);
    expect(sellPrice(byId(2))).toBe(250);
    expect(sellPrice(byId(3))).toBe(2500);
  });

  it('canAfford compares balance to cost', () => {
    const watch = itemById(1);
    expect(watch).toBeDefined();
    if (watch === undefined) return;
    expect(canAfford(100, watch)).toBe(true);
    expect(canAfford(99, watch)).toBe(false);
    expect(canAfford(0, watch)).toBe(false);
  });
});

describe('findItem', () => {
  it('matches by name case-insensitively and trimmed', () => {
    expect(findItem('watch')?.id).toBe(1);
    expect(findItem('  LAPTOP ')?.id).toBe(3);
    expect(findItem('Mobile')?.id).toBe(2);
  });

  it('matches by numeric id as a string', () => {
    expect(findItem('2')?.name).toBe('mobile');
  });

  it('returns undefined for unknown or empty queries', () => {
    expect(findItem('yacht')).toBeUndefined();
    expect(findItem('')).toBeUndefined();
    expect(findItem('   ')).toBeUndefined();
  });
});
