import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL ?? 'postgres://uss:uss@localhost:5432/uss';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

console.log('Running migrations from', dir);
await migrate(db, { migrationsFolder: dir });
console.log('Migrations complete.');
await client.end();
