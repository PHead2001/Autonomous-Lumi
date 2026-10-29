import { createWorldServer } from './world-server.js';
const world = createWorldServer();
const port = Number(process.env.PORT ?? 3001);
try { await world.listen(port); console.log(`Lumi's world: http://127.0.0.1:${port} (simulation runs with zero viewers)`); }
catch (error) { console.error(error); await world.close(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void world.close().then(() => process.exit()); });
