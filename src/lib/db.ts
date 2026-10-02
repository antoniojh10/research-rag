import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

// Reuse the pool across hot reloads in development.
export const pool =
  globalForPg.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

export type DocumentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

/** A paper whose text and figures are embedded in pgvector. */
export type IndexedPaper = {
  id: string;
  filename: string;
  title: string | null;
  authors: string[];
  pageCount: number;
  textChunks: number;
  figureChunks: number;
  indexedAt: string;
};
