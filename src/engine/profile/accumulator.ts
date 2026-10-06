import type { PartialColumn, ValueType } from '../types';
import { classifyValue } from './valueType';
import { hash32 } from '../util/hash';
import { KmvSketch } from '../sketch/kmv';

const CATEGORY_CAP = 5000;
const CATEGORY_MAX_LEN = 100;

export function emptyVotes(): Record<ValueType, number> {
  return { null: 0, integer: 0, decimal: 0, date: 0, boolean: 0, email: 0, string: 0 };
}

/** Streaming per-column counters for ONE shard (phase PARSE). */
export class ColumnAccumulator {
  count = 0;
  nulls = 0;
  votes = emptyVotes();
  styleDot = 0;
  styleComma = 0;
  dateFormats = new Map<string, number>();
  impossibleDates = 0;
  whitespacePadded = 0;
  kmv = new KmvSketch(1024);
  categories = new Map<string, number>();
  categoriesOverflow = false;

  add(raw: string): void {
    this.count++;
    const c = classifyValue(raw);
    this.votes[c.type]++;
    if (c.type === 'null') {
      this.nulls++;
      return;
    }
    if (c.hint === 'dot') this.styleDot++;
    else if (c.hint === 'comma') this.styleComma++;
    if (c.date) {
      this.dateFormats.set(c.date.format, (this.dateFormats.get(c.date.format) ?? 0) + 1);
      if (c.date.impossible) this.impossibleDates++;
    }
    const trimmed = raw.length > 0 && (raw.charCodeAt(0) <= 32 || raw.charCodeAt(raw.length - 1) <= 32) ? raw.trim() : raw;
    if (trimmed !== raw) this.whitespacePadded++;
    this.kmv.add(hash32(trimmed));
    if (!this.categoriesOverflow) {
      if (raw.length > CATEGORY_MAX_LEN) {
        this.categoriesOverflow = true;
        this.categories.clear();
      } else {
        const n = this.categories.get(raw);
        if (n === undefined) {
          if (this.categories.size >= CATEGORY_CAP) {
            this.categoriesOverflow = true;
            this.categories.clear();
          } else this.categories.set(raw, 1);
        } else this.categories.set(raw, n + 1);
      }
    }
  }

  toPartial(): PartialColumn {
    return {
      count: this.count,
      nulls: this.nulls,
      votes: this.votes,
      styleVotes: { dot: this.styleDot, comma: this.styleComma },
      dateFormatVotes: Object.fromEntries(this.dateFormats),
      impossibleDates: this.impossibleDates,
      whitespacePadded: this.whitespacePadded,
      kmv: this.kmv.serialize(),
      categories: this.categoriesOverflow ? [] : [...this.categories.entries()],
      categoriesOverflow: this.categoriesOverflow,
    };
  }
}
