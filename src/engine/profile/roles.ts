import type { ColumnRole } from '../types';
import { nameTokens } from '../util/text';

const ID_TOKENS = new Set([
  'id', 'uuid', 'guid', 'code', 'codigo', 'cod', 'nit', 'cc', 'cedula', 'documento', 'doc', 'phone', 'telefono', 'tel',
  'celular', 'zip', 'postal', 'sku', 'ref', 'referencia', 'reference', 'numero', 'number', 'num', 'nro', 'folio', 'barcode',
  'iban', 'account', 'cuenta', 'serial', 'lote', 'batch',
]);
const KEY_TOKENS = new Set([
  'id', 'uuid', 'guid', 'code', 'codigo', 'sku', 'folio', 'invoice', 'factura', 'number', 'numero', 'nro', 'num', 'ref',
  'referencia', 'reference', 'order', 'orden', 'pedido', 'serial',
]);
const AMOUNT_TOKENS = new Set([
  'amount', 'total', 'subtotal', 'monto', 'valor', 'value', 'price', 'precio', 'cost', 'costo', 'importe', 'pago', 'payment',
  'tax', 'iva', 'impuesto', 'impuestos', 'discount', 'descuento', 'balance', 'saldo', 'revenue', 'ingreso', 'salary', 'sueldo',
  'salario', 'tarifa', 'fee', 'paid', 'pagado',
]);
const PRICE_TOKENS = new Set(['price', 'precio', 'tarifa', 'unitario', 'unit']);
const QTY_TOKENS = new Set(['qty', 'quantity', 'cantidad', 'units', 'unidades', 'stock', 'existencias']);
const AGE_TOKENS = new Set(['age', 'edad']);

export const DATE_ROLE_TOKENS: Record<NonNullable<ColumnRole['dateRole']>, Set<string>> = {
  issue: new Set(['issue', 'issued', 'emision', 'expedicion', 'invoice']),
  due: new Set(['due', 'vencimiento', 'vence', 'expiry', 'expiration', 'expira', 'venc', 'caducidad']),
  start: new Set(['start', 'begin', 'inicio', 'inicial', 'desde', 'from']),
  end: new Set(['end', 'fin', 'final', 'hasta', 'until', 'finish']),
  birth: new Set(['birth', 'nacimiento', 'dob', 'born']),
  created: new Set(['created', 'creation', 'creacion', 'registro', 'registered']),
};

export const DATE_GENERIC_TOKENS = new Set(['date', 'fecha', 'dt', 'at', 'on', 'de', 'of']);

export function hasAny(tokens: string[], set: Set<string>): boolean {
  return tokens.some((t) => set.has(t));
}

export function detectRole(name: string): ColumnRole {
  const tokens = nameTokens(name);
  let dateRole: ColumnRole['dateRole'] = null;
  for (const role of ['birth', 'due', 'start', 'end', 'created', 'issue'] as const) {
    if (hasAny(tokens, DATE_ROLE_TOKENS[role])) {
      dateRole = role;
      break;
    }
  }
  const identifier = hasAny(tokens, ID_TOKENS) && !(hasAny(tokens, AMOUNT_TOKENS) && !hasAny(tokens, KEY_TOKENS));
  return {
    identifier,
    keyCandidate: hasAny(tokens, KEY_TOKENS),
    amount: hasAny(tokens, AMOUNT_TOKENS),
    quantity: hasAny(tokens, QTY_TOKENS),
    price: hasAny(tokens, PRICE_TOKENS),
    age: hasAny(tokens, AGE_TOKENS),
    dateRole,
  };
}

/** Name tokens minus role words: used to pair "contract_start_date" with "contract_end_date". */
export function groupKey(name: string, roleSet: Set<string>): string {
  return nameTokens(name)
    .filter((t) => !roleSet.has(t) && !DATE_GENERIC_TOKENS.has(t))
    .join('_');
}
