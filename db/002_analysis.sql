CREATE TABLE IF NOT EXISTS analyses (
  document_id   uuid PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  -- pending | processing | done | not_paper | error
  status        text        NOT NULL,
  model         text        NOT NULL,
  pages_total   integer     NOT NULL DEFAULT 0,
  pages_done    integer     NOT NULL DEFAULT 0,
  is_paper      boolean,
  reason        text,
  markdown      text,
  result        jsonb,
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS figures (
  document_id   uuid    NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  figure_id     text    NOT NULL,
  page          integer NOT NULL,
  image         bytea   NOT NULL,
  PRIMARY KEY (document_id, figure_id)
);
