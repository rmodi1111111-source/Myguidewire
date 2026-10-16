import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { dispatch, resolveUser } from './routes.js';
import { renderQuotePdf, type QuoteSnapshot } from './services/quoteDoc.js';
import * as wf from './services/workflow.js';
import type { User } from './types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

const id = (req: Request, key = 'id') => Number(req.params[key]);

/** Wrap sync/async handlers so thrown errors reach the error middleware. */
const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch(next);
    else if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? path.join('data', 'uploads'));
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

  // Simple user context: the UI sends X-User-Id (user switcher). Default = first underwriter.
  app.use('/api', (req, res, next) => {
    const user = resolveUser(Number(req.header('x-user-id')) || 0);
    if (!user) return res.status(500).json({ error: 'No users configured - run npm run seed' });
    req.user = user;
    next();
  });

  // ------------------------------------------------------------ documents
  app.post('/api/submissions/:id/documents', upload.single('file'), h((req) =>
    dispatch('POST', `/submissions/${req.params.id}/documents`, {
      query: {}, body: req.body, user: req.user,
      file: req.file && { name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, storagePath: req.file.filename },
    })));
  app.get('/api/documents/:id/download', h(async (req, res) => {
    const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id(req)) as any;
    if (!doc) throw new wf.WorkflowError('Document not found', 404);
    if (doc.quote_id) return res.redirect(`/api/quotes/${doc.quote_id}/pdf`);
    const file = path.join(uploadDir, path.basename(doc.storage_path));
    if (!fs.existsSync(file)) throw new wf.WorkflowError('File missing from storage', 404);
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.name).replace(/"/g, '')}"`);
    fs.createReadStream(file).pipe(res);
  }));
  app.get('/api/quotes/:id/pdf', h(async (req, res) => {
    const q = getDb().prepare('SELECT * FROM quotes WHERE id = ?').get(id(req)) as any;
    if (!q) throw new wf.WorkflowError('Quote not found', 404);
    const pdf = await renderQuotePdf(JSON.parse(q.snapshot_json) as QuoteSnapshot);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Quote-${q.quote_number}.pdf"`);
    res.end(pdf);
  }));

  // ------------------------------------------------------------ shared JSON routes
  app.use('/api', h((req) => dispatch(req.method, req.path, { query: req.query as Record<string, string>, body: req.body, user: req.user })));

  // ------------------------------------------------------------ static web app
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof wf.WorkflowError) return res.status(err.status).json({ error: err.message, details: err.details });
    console.error(err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  });
  return app;
}
