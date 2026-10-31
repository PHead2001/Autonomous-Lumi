import { defaultOwnerCredentialFile, setupOwnerCredential } from './owner-auth.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--rotate')) throw new Error('Usage: npm run owner:pair [-- --rotate]');
const file = defaultOwnerCredentialFile();
try {
  const credential = await setupOwnerCredential(file, args.includes('--rotate'));
  console.log(`Owner pairing configured privately at ${file}. Restart the local server, then enter this credential in Visit. Keep it private:\n${credential}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') console.error('Owner pairing already exists. Use --rotate to replace it, then restart the server to revoke prior sessions.');
  else console.error('Owner pairing failed. Check the private credential location and permissions.');
  process.exitCode = 1;
}
