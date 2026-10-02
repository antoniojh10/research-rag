import { getAnalysisProgress } from "@/lib/analyze";
import { onAnalysisChanged } from "@/lib/events";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Proxies drop idle connections; a comment line every 25 s keeps the stream open.
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of an analysis' progress. Sends the current state on connect and
 * again whenever the pipeline reports a change. Each message is an AnalysisProgress or null.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]/analysis/events">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let last = "";

      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      // Serialized so a slow query can never deliver an older state after a newer one.
      let queue = Promise.resolve();
      const push = () => {
        queue = queue
          .then(async () => {
            if (closed) return;
            const json = JSON.stringify(await getAnalysisProgress(id));
            if (json !== last) {
              last = json;
              send(`data: ${json}\n\n`);
            }
          })
          .catch((err) => console.error("SSE push failed", err));
      };

      const unsubscribe = onAnalysisChanged(id, push);
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      req.signal.addEventListener("abort", cleanup);

      push();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform stops gzip compression from buffering events.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
