import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import { PNG } from 'pngjs';
import { ChromiumRenderer, type RenderedFrame } from './renderer.js';
import { RendererResources } from './resources.js';
import { groundSnapshot } from './grounding.js';
import { createVisibilityFixture } from '../../shared/vision-fixture.js';
import type { RendererBackend } from '../../shared/capture-protocol.js';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function pixelSummary(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes)); let red = 0, yellow = 0, magenta = 0, saturatedBlue = 0, luminance = 0;
  for (let i = 0; i < png.data.length; i += 4) { const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]]; if (r > 60 && r > g * 1.5 && r > b * 1.5) red++; if (r > 70 && g > 65 && r > b * 1.5 && g > b * 1.5) yellow++; if (r > 60 && b > 60 && r > g * 1.6 && b > g * 1.6) magenta++; if (b > 80 && b > r * 1.8 && b > g * 1.8) saturatedBlue++; luminance += .2126 * r + .7152 * g + .0722 * b; }
  return { width: png.width, height: png.height, red, yellow, magenta, saturatedBlue, meanLuminance: luminance / (png.width * png.height) };
}
function comparePixels(a: Uint8Array, b: Uint8Array) { const pa = PNG.sync.read(Buffer.from(a)), pb = PNG.sync.read(Buffer.from(b)); let total = 0, maximum = 0, above8 = 0; for (let i = 0; i < pa.data.length; i++) { const delta = Math.abs(pa.data[i] - pb.data[i]); total += delta; maximum = Math.max(maximum, delta); if (delta > 8) above8++; } return { meanChannelDelta: total / pa.data.length, maximumChannelDelta: maximum, channelsAbove8Fraction: above8 / pa.data.length }; }
async function main() {
  const directory = resolve(arg('--out') ?? join('diagnostics', 'vision-benchmarks', new Date().toISOString().replace(/[^0-9]/g, '')));
  await mkdir(directory, { recursive: true });
  const resources = new RendererResources(join(directory, 'sampler.stop')); await resources.start();
  const cells: object[] = [], backends: object[] = [], baseline = new Map<string, Uint8Array>();
  const fixture = createVisibilityFixture();
  const environment = { node: process.version, os: platform() + ' ' + release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: totalmem() / 1073741824, startUtc: new Date().toISOString() };
  try {
    for (const configuration of ['angle-d3d11', 'swiftshader'] as RendererBackend[]) {
      for (const size of [256, 512, 1024]) {
        const cellStarted = Date.now(), cold: number[] = [], warm: number[] = [], hashes: string[] = [], gpuResources: { geometries: number; textures: number }[] = [];
        let identity: RenderedFrame['backend'] | null = null, failure: string | null = null;
        try {
          // Two isolated cold starts, then five captures in one warmed renderer.
          for (let i = 0; i < 2; i++) { const renderer = new ChromiumRenderer(configuration); try { const started = performance.now(), frame = await renderer.render(fixture, size, size); cold.push(performance.now() - started); hashes.push(digest(frame.bytes)); identity = frame.backend; if (i === 0) { await writeFile(join(directory, `${configuration}-${size}.png`), frame.bytes); if (size === 512) baseline.set(configuration, frame.bytes); } } finally { await renderer.close(); } }
          const renderer = new ChromiumRenderer(configuration);
          try {
            await renderer.render(fixture, size, size);
            const warmStarted = Date.now(), cpu = process.cpuUsage();
            for (let i = 0; i < 5; i++) { const started = performance.now(), frame = await renderer.render(fixture, size, size); warm.push(performance.now() - started); hashes.push(digest(frame.bytes)); if (frame.resources) gpuResources.push(frame.resources); }
            if (new Set(gpuResources.map(r => `${r.geometries}/${r.textures}`)).size > 1) throw new Error('GPU allocation count grows across repeated captures');
            // Brief idle kept-warm interval supplies actual resident/CPU observations, not a daily cost claim.
            await new Promise(done => setTimeout(done, 1200));
            const warmResources = resources.summary(warmStarted), ownCpu = process.cpuUsage(cpu);
            if (!warmResources.available || !warmResources.cpuRateSamples) throw new Error('Warm resource measurement unavailable: ' + warmResources.error);
            cells.push({ configuration, size, coldSamples: cold.length, coldP50Ms: percentile(cold, .5), coldP95Ms: percentile(cold, .95), warmSamples: warm.length, warmP50Ms: percentile(warm, .5), warmP95Ms: percentile(warm, .95), wallMs: Date.now() - cellStarted, sameBackendUniqueHashes: new Set(hashes).size, resources: resources.summary(cellStarted), warmResources, gpuResources, benchmarkParentCpuMs: (ownCpu.user + ownCpu.system) / 1000, identity });
          } finally { await renderer.close(); }
        } catch (error) { failure = error instanceof Error ? error.message : 'render failed'; cells.push({ configuration, size, coldSamples: cold.length, warmSamples: warm.length, failure, resources: resources.summary(cellStarted) }); }
        if (identity && size === 512) {
          const renderer = new ChromiumRenderer(configuration);
          try {
            const original = baseline.get(configuration)!, pixels = pixelSummary(original);
            if (pixels.red < 50 || pixels.yellow < 50 || pixels.magenta !== 0 || pixels.saturatedBlue !== 0) throw new Error('Visual fixture color/occlusion pixel check failed');
            const changed = structuredClone(fixture); changed.scene!.fixtureColor = '#21df68'; changed.scene!.revision++;
            const changedFrame = await renderer.render(changed, 512, 512);
            const dark = structuredClone(fixture); dark.scene!.illumination = 0; dark.scene!.revision++;
            const darkFrame = await renderer.render(dark, 512, 512), darkPixels = pixelSummary(darkFrame.bytes);
            await writeFile(join(directory, `${configuration}-changed.png`), changedFrame.bytes); await writeFile(join(directory, `${configuration}-dark.png`), darkFrame.bytes);
            if (digest(original) === digest(changedFrame.bytes) || darkPixels.meanLuminance > 1) throw new Error('Appearance/illumination pixel check failed');
            const grounding = groundSnapshot(fixture), darkGrounding = groundSnapshot(dark);
            const hidden = grounding.objects.find(o => o.id === 'fixture-behind-wall');
            if (hidden?.status !== 'fully_occluded' || darkGrounding.objects.some(o => o.eligible)) throw new Error('Grounding fixture check failed');
            await renderer.crash();
            const afterCrash = await renderer.render(fixture, 512, 512);
            backends.push({ configuration, startupSuccess: true, identity, zeroSpectatorCaptures: true, fixturePixels: pixels, changedHash: digest(changedFrame.bytes), originalHash: digest(original), darkPixels, grounding, darkGrounding, crashRecoverySucceeded: !!afterCrash.bytes.length });
          } catch (error) { backends.push({ configuration, startupSuccess: true, identity, failure: error instanceof Error ? error.message : 'fixture check failed' }); }
          finally { await renderer.close(); }
        } else if (size === 512) backends.push({ configuration, startupSuccess: false, failure });
      }
    }
  } finally { await resources.stop(); }
  const comparison = baseline.size === 2 ? comparePixels(baseline.get('angle-d3d11')!, baseline.get('swiftshader')!) : null;
  const report = { environment, fixture: 'shared/vision-fixture.ts createVisibilityFixture', cells, backends, comparison, limitations: ['Short local sequential runs: two cold samples and five warm captures per cell; p95 is the maximum sample.', 'Windows CIM samples creation-time-validated Chromium/esbuild descendants, avoiding parent-PID reuse. CPU is observed cumulative CPU with cell baseline subtraction; short-lived processes between samples may be missed. Peak CPU is sampled CPU delta / host elapsed (100% = one logical core), not an instantaneous hardware counter. RSS is sampled, not a guaranteed instantaneous maximum.', 'Resource sampler and benchmark parent CPU are excluded from renderer tree; launch/renderer work includes Chromium children.', 'No spectator browser or authoritative world exists in this standalone benchmark; server zero-viewer continuity is verified separately.', 'Same-backend image hashes identify output; different GPUs/drivers are compared using documented pixel deltas, not required byte equality.', 'No hosting cost or long-uptime reliability claim.'] };
  await writeFile(join(directory, 'benchmark.json'), JSON.stringify(report, null, 2));
  const rows = cells.map(cell => { const c = cell as { configuration: string; size: number; coldP50Ms?: number; coldP95Ms?: number; warmP50Ms?: number; warmP95Ms?: number; resources?: { peakRssMiB?: number | null; observedCpuMs?: number | null; sampleCount: number }; failure?: string }; return `|${c.configuration}|${c.size}|${c.coldP50Ms?.toFixed(1) ?? 'N/A'} / ${c.coldP95Ms?.toFixed(1) ?? 'N/A'}|${c.warmP50Ms?.toFixed(1) ?? 'N/A'} / ${c.warmP95Ms?.toFixed(1) ?? 'N/A'}|${c.resources?.peakRssMiB?.toFixed(1) ?? 'N/A'}|${c.resources?.observedCpuMs?.toFixed(0) ?? 'N/A'}|${c.resources?.sampleCount ?? 0}|${c.failure ?? 'success'}|`; });
  await writeFile(join(directory, 'SUMMARY.md'), `# Actual renderer comparison\n\n${JSON.stringify(environment)}\n\nCold n=2; warm n=5 per successful cell.\n\n|Configuration|Square size|Cold p50/p95 ms|Warm p50/p95 ms|Sampled peak tree RSS MiB|Observed tree CPU ms|Resource samples|Result|\n|---|---:|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n\nCross-backend pixel delta: ${JSON.stringify(comparison)}\n\n${report.limitations.map(s => '- ' + s).join('\n')}\n`);
  console.log(JSON.stringify({ directory, cells: cells.length, backends: backends.map(b => { const v = b as { configuration: string; failure?: string }; return { configuration: v.configuration, status: v.failure ?? 'passed' }; }), comparison }));
  if (backends.some(b => (b as { failure?: string }).failure) || cells.some(cell => (cell as { failure?: string }).failure)) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
