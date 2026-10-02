"use client";

import { useEffect, useState } from "react";
import type { IndexedPaper } from "@/lib/db";

function formatAuthors(authors: string[]) {
  if (authors.length === 0) return null;
  return authors.length > 2 ? `${authors[0]} et al.` : authors.join(", ");
}

/** Papers with embeddings in pgvector. Refetched every time the list is shown. */
export default function PaperList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (documentId: string) => void;
}) {
  const [papers, setPapers] = useState<IndexedPaper[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/papers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPapers)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="px-3 text-sm text-red-600">No se pudo cargar la lista de papers.</p>;
  if (!papers) return <p className="px-3 text-sm text-zinc-500">Cargando…</p>;
  if (papers.length === 0) {
    return (
      <p className="px-3 text-sm text-zinc-500">
        Aún no hay papers indexados. Se indexan automáticamente al terminar su análisis.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {papers.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => onSelect(p.id)}
            className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm ${
              selectedId === p.id ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="line-clamp-2 font-medium">{p.title ?? p.filename}</span>
            {formatAuthors(p.authors) && (
              <span className="truncate text-xs text-zinc-500">{formatAuthors(p.authors)}</span>
            )}
            <span className="text-xs text-zinc-500">
              {p.pageCount} págs · {p.textChunks} fragmentos · {p.figureChunks} figuras
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
