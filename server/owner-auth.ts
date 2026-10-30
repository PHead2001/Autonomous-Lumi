import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { assertOwnedPath } from './checkpoint-storage.js';

export const OWNER_COOKIE = 'lumi_owner';
export const defaultOwnerCredentialFile = () => join(homedir(), '.autonomous-lumi', 'private', 'owner-credential.json');
const digest = (value: string) => createHash('sha256').update(value).digest();
export interface OwnerSession { readonly id: string; readonly csrf: string; readonly expiresAt: number }
/** Host-only state: never attach this object to a simulation, recorder or diagnostic. */
export class OwnerAuth {
  private sessions = new Map<string, OwnerSession>();
  private failures: number[] = [];
  private credentialHash: Buffer | null = null;
  constructor(readonly credentialFile = defaultOwnerCredentialFile(), private readonly now = Date.now) {}
  async load(): Promise<void> {
    try {
      await assertOwnedPath(parse(resolve(this.credentialFile)).root, resolve(this.credentialFile));
      const info = await stat(this.credentialFile);
      if (!info.isFile() || info.size > 1024) throw new Error('Invalid private owner credential file');
      const raw = JSON.parse(await readFile(this.credentialFile, 'utf8'));
      if (raw?.schemaVersion !== 1 || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256) || Object.keys(raw).length !== 2) throw new Error('Invalid private owner credential file');
      this.credentialHash = Buffer.from(raw.sha256, 'hex');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Owner credential configuration is invalid'); }
  }
  get configured(): boolean { return this.credentialHash !== null; }
  login(value: unknown): OwnerSession {
    const now = this.now(); this.failures = this.failures.filter(at => now - at < 60000);
    if (this.failures.length >= 8) throw new Error('Owner login unavailable; retry shortly');
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || !this.credentialHash || !timingSafeEqual(digest(value), this.credentialHash)) {
      this.failures.push(now); throw new Error('Owner login failed');
    }
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    if (this.sessions.size >= 32) throw new Error('Owner session limit reached');
    const session = { id: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'), expiresAt: now + 12 * 60 * 60 * 1000 };
    this.sessions.set(session.id, session); return session;
  }
  session(cookie: string | undefined): OwnerSession | null {
    const matches = (cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(OWNER_COOKIE + '='));
    if (matches.length !== 1) return null;
    const id = matches[0].slice(OWNER_COOKIE.length + 1), session = this.sessions.get(id);
    if (!session || session.expiresAt <= this.now()) { this.sessions.delete(id); return null; }
    return session;
  }
  require(cookie: string | undefined, csrf: unknown): OwnerSession {
    const session = this.session(cookie);
    if (!session || typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) throw new Error('Owner session required');
    return session;
  }
  revoke(session: OwnerSession): void { this.sessions.delete(session.id); }
  close(): void { this.sessions.clear(); this.credentialHash = null; }
}
export const ownerCookie = (session: OwnerSession) => `${OWNER_COOKIE}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;

export function assertOwnerCredentialLocation(file: string, diagnostics = resolve('diagnostics')): void {
  const destination = resolve(file);
  const within = (root: string) => { const suffix = relative(resolve(root), destination); return suffix === '' || suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix); };
  if ([diagnostics, process.cwd()].some(within)) throw new Error('Owner credentials must remain outside diagnostics, project source and client build directories');
}

/** Explicit local setup. The returned credential is displayed once by the local CLI only. */
export async function setupOwnerCredential(file = defaultOwnerCredentialFile(), rotate = false, diagnostics = resolve('diagnostics')): Promise<string> {
  const destination = resolve(file);
  assertOwnerCredentialLocation(destination, diagnostics);
  await assertOwnedPath(parse(destination).root, destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await assertOwnedPath(parse(destination).root, destination);
  const credential = randomBytes(32).toString('base64url');
  await writeFile(destination, JSON.stringify({ schemaVersion: 1, sha256: digest(credential).toString('hex') }) + '\n', { flag: rotate ? 'w' : 'wx', mode: 0o600 });
  return credential;
}
