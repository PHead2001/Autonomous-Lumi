import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnerAuth, ownerCookie, setupOwnerCredential } from '../server/owner-auth.js';

test('explicit pairing persists only a high entropy credential hash and host sessions expire/revoke', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-owner-auth-')), file = join(directory, 'private', 'owner.json');
  try {
    const credential = await setupOwnerCredential(file), disk = await readFile(file, 'utf8');
    assert.equal(credential.length, 43); assert.ok(!disk.includes(credential));
    await assert.rejects(setupOwnerCredential(file), /EEXIST/);
    let now = 1000; const auth = new OwnerAuth(file, () => now); await auth.load();
    assert.equal(auth.configured, true); assert.throws(() => auth.login('wrong'), /login failed/);
    const session = auth.login(credential), cookie = ownerCookie(session);
    assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//);
    assert.equal(auth.session(cookie), session); assert.equal(auth.require(cookie, session.csrf), session);
    assert.throws(() => auth.require(cookie, 'wrong'), /session required/);
    assert.equal(auth.session(cookie + '; lumi_owner=duplicate'), null);
    const restarted = new OwnerAuth(file); await restarted.load(); assert.equal(restarted.session(cookie), null);
    now += 12 * 60 * 60 * 1000; assert.equal(auth.session(cookie), null);
    const fresh = auth.login(credential); auth.revoke(fresh); assert.equal(auth.session(ownerCookie(fresh)), null);
    for (let i = 0; i < 8; i++) assert.throws(() => auth.login('bad'), /login failed/);
    assert.throws(() => auth.login(credential), /unavailable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unconfigured access fails closed and invalid private configuration never exposes its contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-owner-invalid-')), file = join(directory, 'owner.json');
  try {
    const auth = new OwnerAuth(file); await auth.load(); assert.equal(auth.configured, false); assert.throws(() => auth.login('x'.repeat(43)), /failed/);
    await writeFile(file, 'private contents'); await assert.rejects(new OwnerAuth(file).load(), /^Error: Owner credential configuration is invalid$/);
    await assert.rejects(setupOwnerCredential(join(directory, 'diagnostics', 'owner.json'), false, join(directory, 'diagnostics')), /outside diagnostics/);
    await assert.rejects(setupOwnerCredential(join(process.cwd(), 'server', 'private-owner-test.json')), /outside diagnostics/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pairing and rotation reject linked directory destinations before writing through them', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-owner-linked-')), real = join(directory, 'real'), linked = join(directory, 'linked');
  try {
    await mkdir(real); await writeFile(join(real, 'owner.json'), 'preserved');
    try { await symlink(real, linked, 'junction'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Host does not permit test junction creation'); return; } throw error; }
    await assert.rejects(setupOwnerCredential(join(linked, 'owner.json'), true), /Linked storage path/);
    assert.equal(await readFile(join(real, 'owner.json'), 'utf8'), 'preserved');
    await assert.rejects(new OwnerAuth(join(linked, 'owner.json')).load(), /configuration is invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
