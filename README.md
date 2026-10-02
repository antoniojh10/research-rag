# Assistent

Next.js app for uploading images or PDFs, storing them in PostgreSQL (with pgvector), and previewing them.

## Requirements

- Node.js 20+
- Docker

## Getting started

```bash
cp .env.example .env.local   # DATABASE_URL
docker compose up -d         # Postgres 17 + pgvector; creates the table from db/init.sql
npm install
npm run dev                  # http://localhost:3000
```

## Structure

- `docker-compose.yml` — `pgvector/pgvector:pg17` container.
- `db/init.sql` — `vector` extension and `documents` table (file stored as `bytea`, plus an `embedding vector(1536)` column reserved for RAG).
- `src/app/api/files` — `GET` lists files, `POST` uploads one (multipart, `file` field, 20 MB max).
- `src/app/api/files/[id]` — `GET` serves the file inline, `DELETE` removes it.
- `src/components/Uploader.tsx` — drag-and-drop area, file list, and preview.

> `db/init.sql` only runs the first time the volume is created. To reset the database: `docker compose down -v`.
