import { createHash } from 'node:crypto';
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalStringify((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new Error('Canonical data must contain only finite JSON values');
}
export function hashCanonical(value: unknown): string { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
