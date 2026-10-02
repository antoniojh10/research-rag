CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    text        NOT NULL,
  mime_type   text        NOT NULL,
  size_bytes  integer     NOT NULL,
  content     bytea       NOT NULL,
  -- Reserved for embeddings (RAG). 1536 dimensions; adjust to match your model.
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_created_at_idx ON documents (created_at DESC);
