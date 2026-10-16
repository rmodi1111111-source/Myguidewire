// CLI: npm run seed -- resets the database file and loads sample data.
import fs from 'node:fs';
import path from 'node:path';
import { initDb } from './db.js';
import { seed } from './seed.js';

const file = process.env.DB_PATH ?? path.resolve('data', 'prebind.db');
if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
initDb(file);
seed();
console.log(`Seeded ${file}`);
