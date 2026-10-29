import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireLocalLease } from '../local-lease';
import { atomicJson } from '../checkpoint-storage';

type Entry = { id: string; reservedUsd: number; accountedUsd: number; state: 'pending' | 'reported' | 'estimated' | 'unknown'; at: number; expiresAt: number };
type Ledger = { schema: 1; entries: Entry[] };
export class BudgetError extends Error { constructor(public readonly code: 'budget_unavailable' | 'budget_exhausted' | 'duplicate_request' | 'concurrency_limited' | 'frequency_limited') { super(code); } }
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000;

/** Application-wide, outside branch recovery. Pending/unknown reservations are never refunded on restart. */
export class DurableBudget {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, readonly ceilingUsd = 1, private readonly clock = Date.now) {
    if (!validAmount(ceilingUsd)) throw new Error('Invalid budget ceiling');
  }
  private operation<T>(fn: (ledger: Ledger) => Promise<T>): Promise<T> {
    const result = this.serial.then(async () => {
      let lease: Awaited<ReturnType<typeof acquireLocalLease>> | undefined;
      try {
        let created = false;
        try { await mkdir(this.directory, { recursive: false }); created = true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            const { dirname } = await import('node:path'); await mkdir(dirname(this.directory), { recursive: true });
            try { await mkdir(this.directory); created = true; } catch (again) { if ((again as NodeJS.ErrnoException).code !== 'EEXIST') throw again; }
          } else if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        lease = await acquireLocalLease(this.directory);
        const marker = join(this.directory, 'initialized'), path = join(this.directory, 'ledger.json');
        if (created) {
          // A crash between these writes leaves an incomplete directory and therefore fails closed.
          const file = await open(marker, 'wx'); try { await file.writeFile('lumi-cognition-budget-v1'); await file.sync(); } finally { await file.close(); }
          await atomicJson(path, { schema: 1, entries: [] }, true, this.directory);
        }
        if ((await readFile(marker, 'utf8')) !== 'lumi-cognition-budget-v1' || (await stat(path)).size > 2_000_000) throw new Error('Invalid ledger');
        const data: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!data || typeof data !== 'object' || (data as Ledger).schema !== 1 || !Array.isArray((data as Ledger).entries) || (data as Ledger).entries.length > 5000) throw new Error('Invalid ledger');
        const ledger = data as Ledger, ids = new Set<string>();
        for (const entry of ledger.entries) {
          if (!entry || typeof entry.id !== 'string' || !/^[\w:.-]{1,160}$/.test(entry.id) || ids.has(entry.id) || !validAmount(entry.reservedUsd) || !validAmount(entry.accountedUsd) || !['pending','reported','estimated','unknown'].includes(entry.state) || !Number.isFinite(entry.at) || entry.at < 0 || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= entry.at || entry.expiresAt - entry.at > 120000 || ((entry.state === 'pending' || entry.state === 'unknown') && entry.accountedUsd < entry.reservedUsd)) throw new Error('Invalid ledger entry');
          ids.add(entry.id);
        }
        // A dead process cannot settle its callback. Expiry frees only the slot, never the reserved money.
        let expired = false;
        for (const entry of ledger.entries) if (entry.state === 'pending' && entry.expiresAt <= this.clock()) { entry.state = 'unknown'; expired = true; }
        if (expired) await atomicJson(path, ledger, false, this.directory);
        return await fn(ledger);
      } catch (error) { if (error instanceof BudgetError) throw error; throw new BudgetError('budget_unavailable'); }
      finally { await lease?.close(); }
    });
    this.serial = result.catch(() => {}); return result;
  }
  reserve(id: string, amountUsd: number, options: { maxConcurrent?: number; minIntervalMs?: number; now?: number; ttlMs?: number } = {}): Promise<void> {
    return this.operation(async ledger => {
      if (!/^[\w:.-]{1,160}$/.test(id) || !validAmount(amountUsd) || amountUsd <= 0) throw new BudgetError('budget_unavailable');
      if (ledger.entries.some(entry => entry.id === id)) throw new BudgetError('duplicate_request');
      if (ledger.entries.length >= 5000) throw new BudgetError('budget_unavailable');
      if (ledger.entries.filter(entry => entry.state === 'pending').length >= (options.maxConcurrent ?? 1)) throw new BudgetError('concurrency_limited');
      const now = options.now ?? this.clock(), ttl = options.ttlMs ?? 65000;
      if (!Number.isFinite(now) || now < 0 || !Number.isFinite(ttl) || ttl < 100 || ttl > 120000) throw new BudgetError('budget_unavailable');
      if (ledger.entries.some(entry => now - entry.at < (options.minIntervalMs ?? 0))) throw new BudgetError('frequency_limited');
      if (ledger.entries.reduce((total, entry) => total + entry.accountedUsd, 0) + amountUsd > this.ceilingUsd + 1e-12) throw new BudgetError('budget_exhausted');
      ledger.entries.push({ id, reservedUsd: amountUsd, accountedUsd: amountUsd, state: 'pending', at: now, expiresAt: now + ttl });
      await atomicJson(join(this.directory, 'ledger.json'), ledger, false, this.directory);
    });
  }
  settle(id: string, costUsd: number | null, basis: 'reported' | 'estimated' | 'unknown'): Promise<void> {
    return this.operation(async ledger => {
      const entry = ledger.entries.find(value => value.id === id);
      if (entry?.state === 'unknown') return; // A late callback cannot refund an abandoned reservation.
      if (!entry || entry.state !== 'pending') throw new BudgetError('duplicate_request');
      if (basis !== 'unknown' && costUsd !== null && validAmount(costUsd) && costUsd <= entry.reservedUsd) { entry.accountedUsd = costUsd; entry.state = basis; }
      else { entry.state = 'unknown'; entry.accountedUsd = Math.max(entry.reservedUsd, validAmount(costUsd) ? costUsd : 0); }
      await atomicJson(join(this.directory, 'ledger.json'), ledger, false, this.directory);
    });
  }
  snapshot() {
    return this.operation(async ledger => ({ ceilingUsd: this.ceilingUsd, accountedUsd: ledger.entries.reduce((sum, entry) => sum + entry.accountedUsd, 0),
      pending: ledger.entries.filter(entry => entry.state === 'pending').length, unknown: ledger.entries.filter(entry => entry.state === 'unknown').length,
      reportedUsd: ledger.entries.filter(entry => entry.state === 'reported').reduce((sum, entry) => sum + entry.accountedUsd, 0),
      estimatedUsd: ledger.entries.filter(entry => entry.state === 'estimated').reduce((sum, entry) => sum + entry.accountedUsd, 0) }));
  }
}
