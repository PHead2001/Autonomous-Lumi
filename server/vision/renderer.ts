import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build } from 'esbuild';
import type { WorldState } from '../../shared/protocol.js';
import type { RendererBackend, RendererIdentity } from '../../shared/capture-protocol.js';

export const BACKEND_FLAGS: Record<RendererBackend, string[]> = {
  'angle-d3d11': ['--use-gl=angle', '--use-angle=d3d11', '--disable-software-rasterizer'],
  // Explicit opt-in: SwiftShader's JIT has weaker security guarantees; only trusted local source is served.
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
export function chromiumExecutable(): string {
  const configured = process.env.LUMI_CHROMIUM_PATH;
  if (configured) { if (!existsSync(configured)) throw new RendererFailure('unavailable', 'Configured Chromium executable is unavailable'); return configured; }
  const candidates = process.platform === 'win32' ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new RendererFailure('unavailable', 'Chromium unavailable; set LUMI_CHROMIUM_PATH'); return found;
}
export function configuredBackend(): RendererBackend {
  const requested = process.env.LUMI_RENDER_BACKEND;
  return (requested ?? (process.platform === 'win32' ? 'angle-d3d11' : 'swiftshader')) as RendererBackend;
}
export interface RenderedFrame { bytes: Uint8Array; backend: RendererIdentity; resources?: { geometries: number; textures: number } }
export interface FrameRenderer { render(snapshot: WorldState, width: number, height: number): Promise<RenderedFrame>; close(): Promise<void>; readonly cleanupError?: string | null }
export class RendererFailure extends Error { constructor(readonly status: 'unavailable' | 'timeout' | 'failed', message: string) { super(message); } }
let javascript: Promise<Uint8Array> | undefined;
const browserCode = () => javascript ??= build({ entryPoints: [resolve('src/capture-renderer.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120', logLevel: 'silent' }).then(result => result.outputFiles[0].contents);
/** Owns Chromium synchronously from spawn. The browser is the isolated render fault boundary;
 * no Three.js rendering, authoritative simulation, or second recovery owner runs in this process. */
export class ChromiumRenderer implements FrameRenderer {
  private child: ChildProcess | undefined;
  private browser: Browser | undefined;
  private page: Page | undefined;
  private server: Server | undefined;
  private profile: string | undefined;
  private ready: Promise<void> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private closing: Promise<void> | undefined;
  private generation = 0;
  private readonly cleanupProfiles = new Set<string>();
  cleanupError: string | null = null;
  constructor(readonly configuration: RendererBackend = configuredBackend(), readonly timeoutMs = 20000, readonly idleMs = 30000, private readonly hooks: { onSpawn?: (child: ChildProcess) => void; renderDelayMs?: number; removeProfile?: (profile: string) => Promise<void> } = {}) {}
  get pid() { return this.child?.pid; }
  get chromiumPid() { return this.child?.pid; }
  private async launch(generation: number): Promise<void> {
    const executable = chromiumExecutable(), code = await browserCode();
    const current = () => { if (generation !== this.generation) throw new RendererFailure('failed', 'Renderer launch was cancelled'); };
    current();
    this.server = createServer((req, res) => { res.setHeader('Cache-Control', 'no-store'); if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="margin:0"><script src="/renderer.js"></script></body></html>'); } else if (req.url === '/renderer.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(code); } else { res.statusCode = 404; res.end(); } });
    await new Promise<void>(done => this.server!.listen(0, '127.0.0.1', done));
    current();
    const address = this.server.address(); if (!address || typeof address === 'string') throw new RendererFailure('unavailable', 'Renderer endpoint unavailable');
    const origin = `http://127.0.0.1:${address.port}`;
    const profile = await mkdtemp(join(tmpdir(), 'lumi-renderer-'));
    if (generation !== this.generation) { await rm(profile, { recursive: true, force: true }); current(); }
    this.profile = profile;
    const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', ...BACKEND_FLAGS[this.configuration]], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child = child;
    const endpoint = new Promise<string>((resolveEndpoint, reject) => {
      let stderr = ''; const timer = setTimeout(() => reject(new RendererFailure('timeout', 'Chromium launch timed out')), this.timeoutMs);
      const fail = () => { clearTimeout(timer); reject(new RendererFailure('unavailable', 'Chromium exited before renderer startup')); };
      child.once('error', fail); child.once('exit', fail);
      child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); child.removeListener('exit', fail); child.removeListener('error', fail); resolveEndpoint(match[1]); } });
    });
    this.hooks.onSpawn?.(child);
    const browser = await puppeteer.connect({ browserWSEndpoint: await endpoint, protocolTimeout: this.timeoutMs });
    if (generation !== this.generation) { browser.disconnect(); current(); } this.browser = browser;
    const page = await browser.newPage(); current(); this.page = page; await page.setRequestInterception(true);
    this.page.on('request', request => { if (request.url().startsWith(origin + '/')) void request.continue(); else void request.abort(); });
    await this.page.goto(origin, { waitUntil: 'load', timeout: this.timeoutMs });
    await this.page.waitForFunction(() => typeof window.lumiRender === 'function', { timeout: this.timeoutMs });
    this.browser.on('disconnected', () => { if (this.child === child) void this.close().catch(() => { this.cleanupError = 'Renderer cleanup failed after disconnection'; }); });
  }
  private async start() {
    if (this.closing) await this.closing;
    if (this.cleanupProfiles.size) { try { await this.removeProfiles(); } catch { throw new RendererFailure('unavailable', 'Previous renderer profile cleanup failed; inspect local sensor health'); } }
    if (!this.ready) { const generation = ++this.generation; this.ready = this.launch(generation).catch(async error => { if (generation === this.generation) await this.close(); throw error instanceof RendererFailure ? error : new RendererFailure('unavailable', 'Renderer startup failed'); }); }
    return this.ready;
  }
  private armIdle() { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => { void this.close().catch(() => { this.cleanupError = 'Idle renderer profile cleanup failed'; }); }, this.idleMs); this.idleTimer.unref(); }
  async render(snapshot: WorldState, width: number, height: number): Promise<RenderedFrame> {
    if (this.busy) throw new RendererFailure('failed', 'Renderer is already busy');
    if (!(this.configuration in BACKEND_FLAGS)) throw new RendererFailure('unavailable', 'Unknown renderer backend');
    this.busy = true; clearTimeout(this.idleTimer);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          await this.start();
          const generation = this.generation, page = this.page!, browser = this.browser!;
          if (this.hooks.renderDelayMs) await new Promise(done => setTimeout(done, this.hooks.renderDelayMs));
          if (generation !== this.generation) throw new RendererFailure('failed', 'Renderer capture was cancelled');
          const result = await page.evaluate((state, w, h) => window.lumiRender(state, w, h), snapshot, width, height);
          const identity: RendererIdentity = { configuration: this.configuration, chromium: await browser.version(), ...result.backend, flags: BACKEND_FLAGS[this.configuration] };
          if (this.configuration === 'angle-d3d11' && /swiftshader|llvmpipe|software/i.test(identity.webglRenderer)) throw new RendererFailure('unavailable', 'Hardware path resolved to software');
          if (this.configuration === 'swiftshader' && !/swiftshader/i.test(identity.webglRenderer)) throw new RendererFailure('unavailable', 'Explicit SwiftShader backend was not selected');
          if (!result.png.startsWith('data:image/png;base64,') || result.png.length > 8 * 1024 * 1024) throw new RendererFailure('failed', 'Invalid renderer frame');
          this.armIdle(); return { bytes: Buffer.from(result.png.slice('data:image/png;base64,'.length), 'base64'), backend: identity, resources: result.resources };
        })(),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new RendererFailure('timeout', 'Renderer request timed out')), this.timeoutMs); }),
      ]);
    } catch (error) { try { await this.close(); } catch { this.cleanupError = 'Renderer profile cleanup failed after capture failure'; } throw error instanceof RendererFailure ? error : new RendererFailure('failed', 'Renderer process failed'); }
    finally { clearTimeout(deadline); this.busy = false; }
  }
  /** Actual owned browser-process failure, outside the public control surface. */
  async crash() { await this.close(); }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.closeOwned().catch(error => { this.cleanupError = 'Renderer profile cleanup failed'; throw error; }).finally(() => { this.closing = undefined; }); return this.closing;
  }
  private async closeOwned() {
    clearTimeout(this.idleTimer); const child = this.child, browser = this.browser, server = this.server, profile = this.profile;
    this.generation++;
    this.child = undefined; this.browser = undefined; this.page = undefined; this.server = undefined; this.profile = undefined; this.ready = undefined;
    // Always terminate the owned process tree while its root is still alive. This also covers startup faults
    // before a CDP connection exists. Never enumerate/kill unrelated browser sessions.
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') await new Promise<void>(done => { const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); cleanup.once('error', () => { child.kill(); done(); }); cleanup.once('exit', () => done()); });
      else { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
      await new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) return done(); const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 1500); timer.unref(); child.once('exit', () => { clearTimeout(timer); done(); }); });
    }
    browser?.disconnect();
    if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
    if (profile) this.cleanupProfiles.add(profile);
    await this.removeProfiles();
  }
  private async removeProfiles() {
    for (const profile of this.cleanupProfiles) {
      if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('lumi-renderer-')) throw new Error('Refusing unowned renderer cleanup path');
      if (this.hooks.removeProfile) await this.hooks.removeProfile(profile); else await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      this.cleanupProfiles.delete(profile);
    }
    this.cleanupError = null;
  }
}
