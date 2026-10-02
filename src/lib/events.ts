import { EventEmitter } from "node:events";

/**
 * In-process notifications of analysis progress, keyed by document id. Kept on globalThis so the
 * pipeline and the SSE route share one emitter across dev hot reloads. This only works while the
 * app runs as a single process; with several instances, switch to Postgres LISTEN/NOTIFY.
 */
const globalForEvents = globalThis as unknown as { analysisEvents?: EventEmitter };

const emitter = globalForEvents.analysisEvents ?? new EventEmitter();
// One listener per open browser tab; the default cap of 10 would only produce noisy warnings.
emitter.setMaxListeners(0);
globalForEvents.analysisEvents = emitter;

export function notifyAnalysisChanged(documentId: string) {
  emitter.emit(documentId);
}

/** Returns an unsubscribe function. */
export function onAnalysisChanged(documentId: string, listener: () => void) {
  emitter.on(documentId, listener);
  return () => {
    emitter.off(documentId, listener);
  };
}
