import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

/**
 * Pantry memory — "what the user already has", so we don't add it to the cart.
 *
 * Two implementations behind one interface:
 *  - FilePantry:   single local JSON file. Fine for the single-user CLI.
 *  - MemoryPantry: per-instance, isolated. Used PER SESSION on the server so one
 *                  user's pantry never leaks into another's. (Persist to a DB
 *                  keyed by user when auth lands — see PRODUCTION_READINESS.md.)
 */
const DEFAULT_PANTRY = ['salt', 'water'];

export interface PantryStore {
  get(): string[];
  add(items: string[]): string[];
}

const normalize = (items: string[]) => items.map((s) => s.toLowerCase().trim()).filter(Boolean);

export class FilePantry implements PantryStore {
  get(): string[] {
    try {
      if (!existsSync(config.pantryFile)) return [...DEFAULT_PANTRY];
      const items = JSON.parse(readFileSync(config.pantryFile, 'utf8'));
      return Array.isArray(items) ? items : [...DEFAULT_PANTRY];
    } catch {
      return [...DEFAULT_PANTRY];
    }
  }

  add(items: string[]): string[] {
    const set = new Set([...this.get(), ...items].map((s) => s.toLowerCase().trim()));
    const next = [...set].filter(Boolean);
    mkdirSync(dirname(config.pantryFile), { recursive: true });
    writeFileSync(config.pantryFile, JSON.stringify(next, null, 2));
    return next;
  }
}

export class MemoryPantry implements PantryStore {
  private items = new Set<string>(DEFAULT_PANTRY);

  get(): string[] {
    return [...this.items];
  }

  add(items: string[]): string[] {
    for (const it of normalize(items)) this.items.add(it);
    return [...this.items];
  }
}
