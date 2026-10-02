-- Embeddings live per chunk now; the per-document placeholder column was never used.
ALTER TABLE documents DROP COLUMN IF EXISTS embedding;

-- Indexing state of an analyzed paper: NULL (not indexed) | indexing | indexed | error
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS index_status text;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS index_error  text;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS indexed_at   timestamptz;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS index_started_at timestamptz;

CREATE TABLE IF NOT EXISTS chunks (
  id           bigserial   PRIMARY KEY,
  document_id  uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- text: a fragment of the paper's markdown | figure: a figure's label, caption and description
  kind         text        NOT NULL CHECK (kind IN ('text', 'figure')),
  chunk_index  integer     NOT NULL,
  section      text,
  page_start   integer     NOT NULL,
  page_end     integer     NOT NULL,
  figure_id    text,
  content      text        NOT NULL,
  -- Xenova/multilingual-e5-small; changing the model requires a new dimension and reindexing.
  embedding    vector(384) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, kind, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
