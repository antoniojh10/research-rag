const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 6;

/**
 * Models in priority order. OpenRouter falls back to the next one when a model is rate limited
 * or down, which matters for free models served from a shared upstream pool.
 * OpenRouter accepts at most 3; prefer models hosted by different providers.
 */
export const MODELS = (
  process.env.OPENROUTER_MODELS ||
  "qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free,thinkingmachines/inkling:free"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean)
  .slice(0, 3);

export class OpenRouterError extends Error {}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatRequest = {
  system: string;
  content: ContentPart[];
  schemaName: string;
  schema: object;
};

type OpenRouterErrorBody = {
  message?: string;
  code?: number;
  metadata?: {
    raw?: string;
    provider_name?: string;
    limit_source?: string;
    /** Errors from the fallback models that were tried before the final one. */
    previous_errors?: { provider_name?: string; raw?: string; message?: string }[];
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends one multimodal request; returns the parsed JSON matching `schema` and the model that answered. */
export async function chatJson<T>({ system, content, schemaName, schema }: ChatRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError("Falta OPENROUTER_API_KEY en .env.local.");

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Assistent",
      },
      body: JSON.stringify({
        models: MODELS,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });

    // Free models are rate limited (per minute and per day) and often overloaded upstream.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 15_000 * attempt);
      continue;
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new OpenRouterError(describeError(res.status, body?.error));

    const text: string | undefined = body?.choices?.[0]?.message?.content;
    if (!text) throw new OpenRouterError("El modelo devolvió una respuesta vacía.");
    try {
      return { data: JSON.parse(stripFences(text)) as T, model: (body.model as string) ?? MODELS[0] };
    } catch {
      if (attempt < MAX_ATTEMPTS) continue;
      throw new OpenRouterError("El modelo no devolvió un JSON válido.");
    }
  }
}

/** Builds a readable message that keeps OpenRouter's raw upstream details for diagnosis. */
function describeError(status: number, error: OpenRouterErrorBody | undefined) {
  const meta = error?.metadata;
  let summary: string;
  if (status === 429 && meta?.limit_source?.startsWith("upstream")) {
    summary = "Los modelos gratuitos están saturados (límite compartido del proveedor). Reintenta en unos minutos.";
  } else if (status === 429) {
    summary = "Límite de uso de tu cuenta de OpenRouter alcanzado.";
  } else {
    summary = `OpenRouter respondió ${status}.`;
  }

  const attempts = [
    ...(meta?.previous_errors ?? []),
    { provider_name: meta?.provider_name, raw: meta?.raw, message: error?.message },
  ]
    .map((e) => [e.provider_name, e.raw ?? e.message].filter(Boolean).join(": "))
    .filter(Boolean);
  return attempts.length ? `${summary}\n${attempts.map((a) => `- ${a}`).join("\n")}` : summary;
}

// Some providers ignore response_format and wrap the JSON in a code fence.
function stripFences(text: string) {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}
