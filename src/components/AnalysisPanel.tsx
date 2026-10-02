"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { AnalysisProgress, AnalysisStatus } from "@/lib/analyze";
import type { DocumentMeta } from "@/lib/db";

const isRunning = (a: AnalysisProgress | null) => a?.status === "pending" || a?.status === "processing";

export default function AnalysisPanel({ doc }: { doc: DocumentMeta }) {
  // undefined until the first SSE message arrives; null when the document was never analyzed.
  const [progress, setProgress] = useState<AnalysisProgress | null | undefined>(undefined);
  const [full, setFull] = useState<AnalysisStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The server pushes progress only when it changes; EventSource reconnects on its own if dropped.
  useEffect(() => {
    const source = new EventSource(`/api/files/${doc.id}/analysis/events`);
    source.onmessage = (e) => setProgress(JSON.parse(e.data));
    return () => source.close();
  }, [doc.id]);

  // Markdown and JSON are only fetched once per finished run.
  const doneAt = progress?.status === "done" ? progress.updatedAt : null;
  useEffect(() => {
    if (!doneAt) return;
    let cancelled = false;
    fetch(`/api/files/${doc.id}/analysis`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<AnalysisStatus>) : null))
      .then((data) => {
        if (!cancelled) setFull(data);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doneAt]);

  async function start(restart: boolean) {
    setError(null);
    const res = await fetch(`/api/files/${doc.id}/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restart }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo iniciar el análisis.");
    }
  }

  async function reindex() {
    setError(null);
    const res = await fetch(`/api/files/${doc.id}/index`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo iniciar la indexación.");
    }
  }

  if (progress === undefined) return <Centered>Cargando…</Centered>;
  if (doneAt && full?.updatedAt !== doneAt) return <Centered>Cargando resultado…</Centered>;

  const analysis: AnalysisProgress | AnalysisStatus | null = doneAt ? full : progress;

  if (!analysis || isRunning(analysis)) {
    const running = isRunning(analysis);
    return (
      <Centered>
        {running ? (
          <>
            <Spinner />
            <p className="font-medium">Analizando con {analysis!.model}…</p>
            <p className="text-sm text-zinc-500">
              {analysis!.pagesTotal
                ? `Página ${Math.min(analysis!.pagesDone + 1, analysis!.pagesTotal)} de ${analysis!.pagesTotal}`
                : "Preparando documento"}
            </p>
          </>
        ) : (
          <>
            <p className="max-w-sm text-zinc-500">
              Un modelo de visión detectará si es un paper científico, lo convertirá a markdown y
              extraerá sus figuras.
            </p>
            <button
              onClick={() => start(true)}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Analizar
            </button>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </Centered>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <StatusBadge status={analysis.status} />
        <span className="truncate text-zinc-500">{analysis.model}</span>
        {analysis.status === "done" && <IndexState progress={progress!} onReindex={reindex} />}
        <button
          onClick={() => start(true)}
          title="Descarta los resultados y vuelve a analizar todas las páginas"
          className={`${analysis.status === "done" ? "" : "ml-auto "}shrink-0 text-zinc-500 underline-offset-4 hover:underline`}
        >
          Reanalizar
        </button>
      </div>
      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

      {analysis.status === "error" && (
        <Centered>
          <p className="font-medium text-red-600">
            El análisis falló
            {analysis.pagesTotal > 0 && ` (${analysis.pagesDone} de ${analysis.pagesTotal} páginas completadas)`}
          </p>
          <p className="max-w-2xl text-left text-sm break-words whitespace-pre-line text-zinc-500">
            {analysis.error}
          </p>
          <button
            onClick={() => start(false)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {analysis.pagesDone > 0 ? `Reintentar desde la página ${analysis.pagesDone + 1}` : "Reintentar"}
          </button>
        </Centered>
      )}

      {analysis.status === "not_paper" && (
        <Centered>
          <p className="font-medium">No es un paper científico</p>
          <p className="max-w-md text-sm text-zinc-500">{analysis.reason}</p>
        </Centered>
      )}

      {analysis.status === "done" && (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <article className="prose prose-zinc max-w-none overflow-auto p-6 dark:prose-invert prose-img:mx-auto prose-img:max-h-[60vh] prose-img:rounded-md prose-img:bg-white">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {full?.markdown ?? ""}
            </ReactMarkdown>
          </article>
          <JsonView value={full?.result} />
        </div>
      )}
    </div>
  );
}

function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative min-h-0 overflow-auto border-t border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 xl:border-t-0 xl:border-l">
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="sticky top-2 float-right mr-2 rounded bg-zinc-200 px-2 py-1 text-xs dark:bg-zinc-800"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
      <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

/** Embedding index state; read from the live progress, since `full` is only fetched once. */
function IndexState({ progress, onReindex }: { progress: AnalysisProgress; onReindex: () => void }) {
  const { indexStatus, indexError, textChunks, figureChunks } = progress;
  const link = "shrink-0 text-zinc-500 underline-offset-4 hover:underline";

  if (indexStatus === "indexing") {
    return <span className="ml-auto shrink-0 text-zinc-500">Generando embeddings…</span>;
  }
  return (
    <>
      <span
        title={indexError ?? undefined}
        className={`ml-auto shrink-0 ${indexStatus === "error" ? "text-red-600" : "text-zinc-500"}`}
      >
        {indexStatus === "indexed"
          ? `Indexado · ${textChunks} fragmentos · ${figureChunks} figuras`
          : indexStatus === "error"
            ? "Error al indexar"
            : "Sin indexar"}
      </span>
      <button onClick={onReindex} className={link}>
        {indexStatus === "indexed" ? "Reindexar" : "Indexar"}
      </button>
    </>
  );
}

function StatusBadge({ status }: { status: AnalysisProgress["status"] }) {
  const styles = {
    done: ["Paper científico", "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"],
    not_paper: ["No es un paper", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
    error: ["Error", "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"],
    pending: ["En cola", "bg-zinc-200 text-zinc-700"],
    processing: ["Procesando", "bg-zinc-200 text-zinc-700"],
  } as const;
  const [label, cls] = styles[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">{children}</div>
  );
}

function Spinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />;
}
