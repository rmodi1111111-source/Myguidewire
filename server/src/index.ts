import { createApp } from './app.js';
import { getDb, initDb } from './db.js';
import { seed } from './seed.js';

initDb();
const userCount = (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (userCount === 0) {
  console.log('Empty database - loading sample data');
  seed();
}

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, () => console.log(`Pre-bind workbench API listening on http://localhost:${port}`));
