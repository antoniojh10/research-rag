export type PageMarkdown = { page: number; markdown: string };

export type TextChunk = {
  section: string | null;
  pageStart: number;
  pageEnd: number;
  content: string;
};

type Block = { page: number; text: string; tokens: number };

type CountTokens = (text: string) => Promise<number>;

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

/**
 * Splits a paper's markdown into chunks that follow its sections: a heading always starts a new
 * chunk, and a section longer than `maxTokens` is split between paragraphs, repeating the last
 * paragraph of a chunk at the start of the next one for context. Figure images are left out;
 * figures are indexed separately from their caption and description.
 */
export async function chunkMarkdown(
  pages: PageMarkdown[],
  countTokens: CountTokens,
  maxTokens: number,
): Promise<TextChunk[]> {
  const chunks: TextChunk[] = [];
  const headings: string[] = [];
  let current: Block[] = [];
  let currentTokens = 0;

  // Level 1 is the paper title, which is already part of every embedded chunk.
  const section = () => headings.slice(1).filter(Boolean).join(" > ") || null;

  const flush = (keepOverlap: boolean) => {
    if (!current.length) return;
    chunks.push({
      section: section(),
      pageStart: current[0].page,
      pageEnd: current[current.length - 1].page,
      content: current.map((b) => b.text).join("\n\n"),
    });
    const last = current[current.length - 1];
    const overlap = keepOverlap && current.length > 1 && last.tokens <= maxTokens / 3;
    current = overlap ? [last] : [];
    currentTokens = overlap ? last.tokens : 0;
  };

  for (const { page, markdown } of pages) {
    for (const paragraph of markdown.split(/\n\s*\n/)) {
      const text = paragraph
        .split("\n")
        .filter((line) => !IMAGE_LINE.test(line.trim()))
        .join("\n")
        .trim();
      if (!text) continue;

      const heading = text.match(HEADING);
      if (heading && !text.includes("\n")) {
        flush(false);
        const level = heading[1].length;
        headings.length = level;
        headings[level - 1] = heading[2].replace(/^[*_]+|[*_]+$/g, "").trim();
        continue;
      }

      for (const piece of await splitOversized(text, countTokens, maxTokens)) {
        if (currentTokens + piece.tokens > maxTokens) flush(true);
        current.push({ page, ...piece });
        currentTokens += piece.tokens;
      }
    }
  }
  flush(false);
  return chunks;
}

/** Breaks a paragraph that does not fit in one chunk by sentences, then lines, then words. */
async function splitOversized(text: string, countTokens: CountTokens, maxTokens: number) {
  const tokens = await countTokens(text);
  if (tokens <= maxTokens) return [{ text, tokens }];

  const separators: [RegExp, string][] = [
    [/(?<=[.!?])\s+/, " "],
    [/\n/, "\n"],
    [/\s+/, " "],
  ];
  for (const [pattern, joiner] of separators) {
    const parts = text.split(pattern).filter(Boolean);
    if (parts.length < 2) continue;

    const pieces: { text: string; tokens: number }[] = [];
    let buffer = "";
    for (const part of parts) {
      const candidate = buffer ? buffer + joiner + part : part;
      if (buffer && (await countTokens(candidate)) > maxTokens) {
        pieces.push(...(await splitOversized(buffer, countTokens, maxTokens)));
        buffer = part;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) pieces.push(...(await splitOversized(buffer, countTokens, maxTokens)));
    return pieces;
  }

  // A single unbreakable token run (e.g. a huge equation); the model truncates what does not fit.
  return [{ text, tokens }];
}
