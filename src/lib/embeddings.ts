import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/** Must match the vector(...) dimension of chunks.embedding. */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIMENSIONS = 384;
/** The model truncates input beyond this many tokens. */
export const EMBEDDING_MAX_TOKENS = 512;

const BATCH_SIZE = 16;

env.cacheDir = path.join(process.cwd(), ".cache", "models");

// Loading takes a few seconds (and a ~120 MB download the first time), so share one instance.
const globalForModel = globalThis as unknown as { extractor?: Promise<FeatureExtractionPipeline> };

function getExtractor() {
  globalForModel.extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
  return globalForModel.extractor;
}

export async function countTokens(text: string) {
  const extractor = await getExtractor();
  return extractor.tokenizer.encode(text).length;
}

/** Embeds document passages. E5 models expect the "passage: " prefix (and "query: " for searches). */
export async function embedPassages(texts: string[]) {
  const extractor = await getExtractor();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => `passage: ${t}`);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
}

/** pgvector's text input format. */
export function toVectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}
