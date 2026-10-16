import { createApp } from './app.js';
import { getDb, initDb } from './db.js';
import { seed, seedPolicyExamples } from './seed.js';

initDb();
const userCount = (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (userCount === 0) {
  console.log('Empty database - loading sample data');
  seed();
} else if ((getDb().prepare('SELECT COUNT(*) AS n FROM policies').get() as { n: number }).n === 0) {
  console.log('Adding sample policies');
  seedPolicyExamples();
}

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, () => console.log(`Pre-bind workbench API listening on http://localhost:${port}`));
