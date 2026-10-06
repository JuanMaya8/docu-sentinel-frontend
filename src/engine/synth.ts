/**
 * Seeded synthetic datasets WITH ground truth. Used by the UI ("Generar datos de ejemplo"), the benchmark,
 * and the tests that measure detector recall. Anomalies are injected in distinct rows, one per row.
 * Everything streams into chunks so million-row files can be generated inside a Blob.
 */
import { mulberry32 } from './util/prng';
import type { AnomalyType } from './types';

export type SynthKind = 'invoices' | 'inventory' | 'orders';

export interface SynthOptions {
  kind: SynthKind;
  rows: number;
  seed?: number;
  /** share of rows that receive an injected anomaly (default 0.01) */
  anomalyRate?: number;
}

export interface TruthItem {
  /** 0-based data row index */
  row: number;
  type: AnomalyType | 'ml_outlier';
  field?: string;
}

export interface SynthResult {
  blob: Blob;
  fileName: string;
  format: 'csv' | 'json';
  rows: number;
  truth: TruthItem[];
}

const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga', 'Pereira', 'Manizales', 'Cúcuta', 'Pasto'];
const CITY_VARIANTS: Record<string, string[]> = {
  Bogotá: ['Bogota', 'BOGOTÁ', 'bogotá'],
  Medellín: ['Medellin', 'MEDELLÍN', 'medellin'],
  Cali: ['CALI', 'cali', 'Cali '],
  Barranquilla: ['BARRANQUILLA', 'barranquilla'],
  Cartagena: ['CARTAGENA', 'cartagena'],
  Bucaramanga: ['BUCARAMANGA', 'bucaramanga'],
  Pereira: ['PEREIRA', 'pereira'],
  Manizales: ['MANIZALES', 'manizales'],
  Cúcuta: ['Cucuta', 'CÚCUTA', 'cucuta'],
  Pasto: ['PASTO', 'pasto'],
};
const STATUSES = ['pagada', 'pendiente', 'anulada'];
const PREFIX = ['Andes', 'Cafetera', 'Delta', 'Horizonte', 'Pacífico', 'Sabana', 'Tequendama', 'Orinoquía', 'Caribe', 'Nevado', 'Aurora', 'Cordillera', 'Frontera', 'Magdalena', 'Zafiro'];
const SUFFIX = ['Logística', 'Textiles', 'Alimentos', 'Ingeniería', 'Comercial', 'Servicios', 'Construcciones', 'Tecnología', 'Agro', 'Muebles', 'Químicos', 'Transportes'];

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function ddmmyyyy(epochDays: number): string {
  const d = new Date(epochDays * 86_400_000);
  return `${pad(d.getUTCDate(), 2)}/${pad(d.getUTCMonth() + 1, 2)}/${d.getUTCFullYear()}`;
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

class Rng {
  private next = mulberry32(1);
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  normal(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/** Picks `count` distinct row indexes in [1, rows) (row 0 is never anomalous so duplicates have a predecessor). */
function pickRows(rng: Rng, rows: number, count: number): number[] {
  const set = new Set<number>();
  const target = Math.min(count, Math.max(0, rows - 2));
  while (set.size < target) set.add(rng.int(1, rows - 1));
  return [...set].sort((a, b) => a - b);
}

export function generateDataset(opts: SynthOptions): SynthResult {
  switch (opts.kind) {
    case 'invoices':
      return generateInvoices(opts);
    case 'inventory':
      return generateInventory(opts);
    case 'orders':
      return generateOrders(opts);
  }
}

// ------------------------------------------------------------------ invoices (CSV)

const INVOICE_HEADER = ['invoice_number', 'customer', 'nit', 'issue_date', 'due_date', 'city', 'status', 'quantity', 'unit_price', 'subtotal', 'tax', 'total', 'email'];

const INVOICE_KINDS: AnomalyType[] = [
  'duplicate_exact',
  'duplicate_key',
  'duplicate_near',
  'missing_field',
  'type_mismatch',
  'impossible_date',
  'out_of_range',
  'negative_value',
  'impossible_relation',
  'inconsistent_label',
  'whitespace',
  'suspicious_threshold',
];

function generateInvoices(opts: SynthOptions): SynthResult {
  const rng = new Rng(opts.seed ?? 7);
  const rows = opts.rows;
  const rate = opts.anomalyRate ?? 0.01;
  const customers = Array.from({ length: 300 }, (_, i) => ({
    name: `${PREFIX[i % PREFIX.length]} ${SUFFIX[Math.floor(i / PREFIX.length) % SUFFIX.length]} ${i < 180 ? 'S.A.S.' : 'Ltda.'}`,
    nit: String(800_000_000 + i * 1_337 + 11),
    email: `contabilidad${i}@cliente${i}.co`,
  }));
  // one anomaly every ~1/rate rows, kinds assigned round-robin so every kind appears
  const anomalyRows = pickRows(rng, rows, Math.round(rows * rate));
  const plan = new Map<number, AnomalyType>();
  anomalyRows.forEach((r, i) => plan.set(r, INVOICE_KINDS[i % INVOICE_KINDS.length]));
  // threshold bunching needs a small dense cluster: reserve extra rows (0.4%) for it
  const bunchRows = pickRows(rng, rows, Math.max(0, Math.round(rows * rate * 0.4)));
  for (const r of bunchRows) if (!plan.has(r)) plan.set(r, 'suspicious_threshold');

  const truth: TruthItem[] = [];
  const parts: string[] = [INVOICE_HEADER.join(',') + '\n'];
  let chunk: string[] = [];
  let prevLine = '';
  let prevFields: string[] = [];
  const recentNumbers: string[] = [];
  const base = Math.floor(Date.UTC(2024, 0, 1) / 86_400_000);

  for (let i = 0; i < rows; i++) {
    const c = customers[rng.int(0, customers.length - 1)];
    const issue = base + rng.int(0, 700);
    const terms = rng.pick([15, 30, 30, 45, 60]);
    const city = rng.pick(CITIES);
    const qty = rng.int(1, 50);
    const price = Math.max(1000, Math.round(Math.exp(10.8 + 0.8 * rng.normal()) / 100) * 100);
    const subtotal = qty * price;
    const tax = Math.round(subtotal * 0.19);
    const f = [
      `INV-${pad(i + 1, 7)}`,
      c.name,
      c.nit,
      ddmmyyyy(issue),
      ddmmyyyy(issue + terms),
      city,
      rng.pick(STATUSES),
      String(qty),
      String(price),
      String(subtotal),
      String(tax),
      String(subtotal + tax),
      c.email,
    ];
    const kind = plan.get(i);
    let field: string | undefined;
    if (kind && i > 0) {
      switch (kind) {
        case 'duplicate_exact':
          for (let k = 0; k < f.length; k++) f[k] = prevFields[k];
          break;
        case 'duplicate_key':
          f[0] = recentNumbers[rng.int(0, recentNumbers.length - 1)] ?? prevFields[0];
          field = 'invoice_number';
          break;
        case 'duplicate_near':
          for (let k = 1; k < f.length; k++) f[k] = prevFields[k];
          f[1] = f[1].toUpperCase();
          f[12] = ' ' + f[12];
          break;
        case 'missing_field':
          field = rng.pick(['customer', 'total', 'city']);
          f[INVOICE_HEADER.indexOf(field)] = '';
          break;
        case 'type_mismatch':
          field = 'quantity';
          f[7] = rng.pick(['diez', 'N.D.', 'abc', 'varios']);
          break;
        case 'impossible_date':
          field = 'issue_date';
          f[3] = rng.pick(['31/02/2025', '30/02/2024', '31/04/2025', '29/02/2023']);
          break;
        case 'out_of_range': {
          field = 'unit_price';
          const p = price * rng.int(150, 400);
          f[8] = String(p);
          f[9] = String(qty * p);
          f[10] = String(Math.round(qty * p * 0.19));
          f[11] = String(qty * p + Math.round(qty * p * 0.19));
          break;
        }
        case 'negative_value':
          field = 'quantity';
          f[7] = String(-rng.int(1, 9));
          break;
        case 'impossible_relation':
          if (rng.float() < 0.5) {
            field = 'total';
            f[11] = String(Math.round((subtotal + tax) * rng.pick([0.2, 3, 5])));
          } else {
            field = 'due_date';
            f[4] = ddmmyyyy(issue - rng.int(20, 90));
          }
          break;
        case 'inconsistent_label':
          field = 'city';
          f[5] = rng.pick(CITY_VARIANTS[city]);
          break;
        case 'whitespace':
          field = 'customer';
          f[1] = `  ${f[1]}  `;
          break;
        case 'suspicious_threshold': {
          field = 'subtotal';
          const target = Math.round(5_000_000 * (0.975 + rng.float() * 0.024));
          const q2 = rng.int(1, 20);
          const p2 = Math.round(target / q2);
          const sub = q2 * p2;
          f[7] = String(q2);
          f[8] = String(p2);
          f[9] = String(sub);
          f[10] = String(Math.round(sub * 0.19));
          f[11] = String(sub + Math.round(sub * 0.19));
          break;
        }
      }
      truth.push({ row: i, type: kind, field });
    }
    const line = f.map(csvEscape).join(',') + '\n';
    chunk.push(line);
    prevLine = line;
    prevFields = f;
    if (kind !== 'duplicate_key') {
      recentNumbers.push(f[0]);
      if (recentNumbers.length > 50) recentNumbers.shift();
    }
    if (chunk.length >= 20_000) {
      parts.push(chunk.join(''));
      chunk = [];
    }
  }
  void prevLine;
  if (chunk.length) parts.push(chunk.join(''));
  return { blob: new Blob(parts, { type: 'text/csv' }), fileName: `facturas_${rows}.csv`, format: 'csv', rows, truth };
}

// ------------------------------------------------------------------ inventory (JSON)

function generateInventory(opts: SynthOptions): SynthResult {
  const rng = new Rng(opts.seed ?? 11);
  const rows = opts.rows;
  const rate = opts.anomalyRate ?? 0.01;
  const kinds: AnomalyType[] = ['impossible_relation', 'negative_value', 'out_of_range', 'missing_field', 'duplicate_key', 'type_mismatch'];
  const anomalyRows = pickRows(rng, rows, Math.round(rows * rate));
  const plan = new Map<number, AnomalyType>();
  anomalyRows.forEach((r, i) => plan.set(r, kinds[i % kinds.length]));
  const truth: TruthItem[] = [];
  const objs: string[] = [];
  const skus: string[] = [];
  for (let i = 0; i < rows; i++) {
    const min = rng.int(5, 50);
    const max = min + rng.int(50, 400);
    const o: Record<string, unknown> = {
      sku: `SKU-${pad(i + 1, 6)}`,
      name: `Producto ${i + 1}`,
      category: rng.pick(['Ferretería', 'Papelería', 'Aseo', 'Eléctricos', 'Plomería']),
      stock: rng.int(min, max),
      min_stock: min,
      max_stock: max,
      unit_price: Math.max(500, Math.round(Math.exp(9.5 + 0.9 * rng.normal()) / 50) * 50),
      warehouse: { code: rng.pick(['BOG', 'MED', 'CLO']), zone: rng.pick(['A', 'B', 'C']) },
      last_count: ddmmyyyy(Math.floor(Date.UTC(2025, 0, 1) / 86_400_000) + rng.int(0, 250)),
    };
    const kind = plan.get(i);
    let field: string | undefined;
    if (kind && i > 0) {
      switch (kind) {
        case 'impossible_relation':
          field = 'min_stock';
          o.min_stock = (o.max_stock as number) + rng.int(10, 100);
          break;
        case 'negative_value':
          field = 'stock';
          o.stock = -rng.int(1, 40);
          break;
        case 'out_of_range':
          field = 'unit_price';
          o.unit_price = (o.unit_price as number) * rng.int(200, 600);
          break;
        case 'missing_field':
          field = 'category';
          o.category = null;
          break;
        case 'duplicate_key':
          field = 'sku';
          o.sku = skus[rng.int(0, skus.length - 1)];
          break;
        case 'type_mismatch':
          field = 'stock';
          o.stock = rng.pick(['muchas', 'N/D?', 'cero']);
          break;
      }
      truth.push({ row: i, type: kind, field });
    }
    skus.push(o.sku as string);
    objs.push(JSON.stringify(o));
  }
  const parts: string[] = ['[\n'];
  for (let i = 0; i < objs.length; i += 20_000) parts.push(objs.slice(i, i + 20_000).join(',\n') + (i + 20_000 < objs.length ? ',\n' : '\n'));
  parts.push(']\n');
  return { blob: new Blob(parts, { type: 'application/json' }), fileName: `inventario_${rows}.json`, format: 'json', rows, truth };
}

// ------------------------------------------------------------------ orders (CSV, for the AI model)

/** shipping_cost is tightly tied to distance and weight; anomalies break that tie while each column stays "in range". */
function generateOrders(opts: SynthOptions): SynthResult {
  const rng = new Rng(opts.seed ?? 21);
  const rows = opts.rows;
  const rate = opts.anomalyRate ?? 0.01;
  const outliers = new Set(pickRows(rng, rows, Math.round(rows * rate)));
  const truth: TruthItem[] = [];
  const parts: string[] = ['order_id,customer_id,weight_kg,distance_km,items,shipping_cost,total\n'];
  let chunk: string[] = [];
  for (let i = 0; i < rows; i++) {
    let weight = Math.round((0.5 + Math.abs(rng.normal()) * 6) * 10) / 10;
    let distance = Math.round(20 + rng.float() * 1200);
    const items = rng.int(1, 12);
    let shipping = Math.round(3000 + 45 * distance + 1200 * weight + rng.normal() * 800);
    if (outliers.has(i) && i > 0) {
      // heavy parcel travelling far for a "short trip" price: every column is individually plausible
      // (long distances, heavy parcels and cheap shipping all exist) but the combination is not.
      distance = rng.int(900, 1200);
      weight = Math.round((8 + rng.float() * 12) * 10) / 10;
      shipping = rng.int(3000, 6000);
      truth.push({ row: i, type: 'ml_outlier', field: 'shipping_cost' });
    }
    const total = items * Math.round(20_000 + rng.float() * 80_000) + shipping;
    chunk.push(`ORD-${pad(i + 1, 7)},C${pad(rng.int(1, 5000), 5)},${weight},${distance},${items},${shipping},${total}\n`);
    if (chunk.length >= 20_000) {
      parts.push(chunk.join(''));
      chunk = [];
    }
  }
  if (chunk.length) parts.push(chunk.join(''));
  return { blob: new Blob(parts, { type: 'text/csv' }), fileName: `pedidos_${rows}.csv`, format: 'csv', rows, truth };
}
