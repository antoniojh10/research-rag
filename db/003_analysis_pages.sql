-- Per-page results, so a failed analysis can resume where it stopped instead of starting over.
CREATE TABLE IF NOT EXISTS analysis_pages (
  document_id   uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page          integer     NOT NULL,
  -- Model that actually answered (may be a fallback).
  model         text        NOT NULL,
  -- { markdown, figures, classification? } — classification only on page 1.
  data          jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, page)
);
