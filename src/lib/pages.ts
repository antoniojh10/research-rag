import * as mupdf from "mupdf";
import sharp from "sharp";

export type PageImage = {
  /** 1-based page number. */
  number: number;
  png: Buffer;
  width: number;
  height: number;
  /** Text layer extracted from the PDF, if any (helps the model transcribe accurately). */
  text: string | null;
};

// Render at ~144 DPI: enough for the model to read small print and for usable figure crops.
const PDF_SCALE = 2;
const MAX_IMAGE_SIDE = 2000;

export function countPages(content: Buffer, mimeType: string) {
  if (mimeType !== "application/pdf") return 1;
  return mupdf.Document.openDocument(content, mimeType).countPages();
}

/**
 * Yields one rendered image per page; a plain image file is treated as a single page.
 * Pages for which `include` returns false are skipped without rendering.
 */
export async function* renderPages(
  content: Buffer,
  mimeType: string,
  maxPages: number,
  include: (pageNumber: number) => boolean = () => true,
): AsyncGenerator<PageImage> {
  if (mimeType !== "application/pdf") {
    if (!include(1)) return;
    const { data, info } = await sharp(content)
      .rotate()
      .resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    yield { number: 1, png: data, width: info.width, height: info.height, text: null };
    return;
  }

  const doc = mupdf.Document.openDocument(content, mimeType);
  try {
    const total = Math.min(doc.countPages(), maxPages);
    for (let i = 0; i < total; i++) {
      if (!include(i + 1)) continue;
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(PDF_SCALE, PDF_SCALE),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      const text = page.toStructuredText("preserve-whitespace").asText().trim();
      yield {
        number: i + 1,
        png: Buffer.from(pixmap.asPNG()),
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
        text: text || null,
      };
      pixmap.destroy();
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/** Bounding box normalized to 0-1000 on both axes: [x0, y0, x1, y1]. */
export type Bbox = [number, number, number, number];

const PAD = 8; // ~0.8% padding so tight boxes do not clip axis labels.

export function normalizeBbox(raw: number[]): Bbox | null {
  if (raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n: number) => Math.min(1000, Math.max(0, n));
  const [x0, y0, x1, y1] = [
    clamp(Math.min(raw[0], raw[2]) - PAD),
    clamp(Math.min(raw[1], raw[3]) - PAD),
    clamp(Math.max(raw[0], raw[2]) + PAD),
    clamp(Math.max(raw[1], raw[3]) + PAD),
  ];
  // Reject degenerate boxes (less than 2% of the page on either side).
  if (x1 - x0 < 20 || y1 - y0 < 20) return null;
  return [x0, y0, x1, y1];
}

export async function cropFigure(page: PageImage, bbox: Bbox) {
  const left = Math.round((bbox[0] / 1000) * page.width);
  const top = Math.round((bbox[1] / 1000) * page.height);
  const width = Math.min(page.width - left, Math.round(((bbox[2] - bbox[0]) / 1000) * page.width));
  const height = Math.min(page.height - top, Math.round(((bbox[3] - bbox[1]) / 1000) * page.height));
  return sharp(page.png).extract({ left, top, width, height }).png().toBuffer();
}

/** JPEG is ~5x smaller than PNG for page renders and plenty for the model. */
export function toModelImage(page: PageImage) {
  return sharp(page.png).jpeg({ quality: 85 }).toBuffer();
}
