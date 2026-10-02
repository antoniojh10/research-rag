"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentMeta } from "@/lib/db";
import AnalysisPanel from "@/components/AnalysisPanel";
import PaperList from "@/components/PaperList";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Uploader() {
  const [files, setFiles] = useState<DocumentMeta[]>([]);
  const [selected, setSelected] = useState<DocumentMeta | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "analysis">("preview");
  const [view, setView] = useState<"files" | "papers">("files");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: DocumentMeta[]) => {
        setFiles(data);
        setSelected((cur) => cur ?? data[0] ?? null);
      })
      .catch(() => setError("No se pudo conectar con la base de datos."));
  }, []);

  const upload = useCallback(async (list: FileList | File[]) => {
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/files", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(`${file.name}: ${data.error ?? "error al subir"}`);
          continue;
        }
        setFiles((prev) => [data as DocumentMeta, ...prev]);
        setSelected(data as DocumentMeta);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  async function remove(doc: DocumentMeta) {
    const res = await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
    if (!res.ok) return setError("No se pudo eliminar el archivo.");
    const rest = files.filter((f) => f.id !== doc.id);
    setFiles(rest);
    if (selected?.id === doc.id) setSelected(rest[0] ?? null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <section className="flex flex-col gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
          }`}
        >
          <svg className="h-10 w-10 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <p className="font-medium">
            {uploading ? "Subiendo…" : "Arrastra archivos aquí o haz clic"}
          </p>
          <p className="text-sm text-zinc-500">Imágenes o PDF · máx. 20 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <nav className="flex rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
          {(["files", "papers"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
                view === v
                  ? "bg-white shadow-sm dark:bg-zinc-700"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {v === "files" ? "Archivos" : "Papers indexados"}
            </button>
          ))}
        </nav>

        {view === "papers" ? (
          <PaperList
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              const doc = files.find((f) => f.id === id);
              if (!doc) return;
              setSelected(doc);
              setTab("analysis");
            }}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.id}>
                <div
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    selected?.id === f.id
                      ? "bg-zinc-200 dark:bg-zinc-800"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  <button onClick={() => setSelected(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="shrink-0 rounded bg-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-zinc-700">
                      {f.mimeType === "application/pdf" ? "PDF" : "IMG"}
                    </span>
                    <span className="truncate">{f.filename}</span>
                    <span className="ml-auto shrink-0 text-xs text-zinc-500">{formatSize(f.sizeBytes)}</span>
                  </button>
                  <button
                    onClick={() => remove(f)}
                    aria-label={`Eliminar ${f.filename}`}
                    className="text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex h-[85vh] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-zinc-500">Sube un archivo para ver la vista previa</p>
          </div>
        ) : (
          <>
            <nav className="flex gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-800">
              {(["preview", "analysis"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                    tab === t
                      ? "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {t === "preview" ? "Vista previa" : "Análisis"}
                </button>
              ))}
            </nav>
            {tab === "preview" ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {selected.mimeType === "application/pdf" ? (
                  <iframe key={selected.id} src={`/api/files/${selected.id}`} title={selected.filename} className="h-full w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={selected.id}
                    src={`/api/files/${selected.id}`}
                    alt={selected.filename}
                    className="max-h-full max-w-full object-contain p-4"
                  />
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <AnalysisPanel key={selected.id} doc={selected} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
