import { pool, type DocumentMeta } from "@/lib/db";

const MAX_BYTES = 20 * 1024 * 1024;

const META_COLUMNS = `id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"`;

// SVG is excluded: it is served inline from the same origin and could run scripts.
function isAllowed(type: string) {
  return (type.startsWith("image/") && type !== "image/svg+xml") || type === "application/pdf";
}

export async function GET() {
  const { rows } = await pool.query<DocumentMeta>(
    `SELECT ${META_COLUMNS} FROM documents ORDER BY created_at DESC`,
  );
  return Response.json(rows);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }
  if (!isAllowed(file.type)) {
    return Response.json({ error: "Solo se permiten imágenes o PDFs." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "El archivo supera los 20 MB." }, { status: 413 });
  }

  const content = Buffer.from(await file.arrayBuffer());
  const { rows } = await pool.query<DocumentMeta>(
    `INSERT INTO documents (filename, mime_type, size_bytes, content)
     VALUES ($1, $2, $3, $4)
     RETURNING ${META_COLUMNS}`,
    [file.name, file.type, file.size, content],
  );

  return Response.json(rows[0], { status: 201 });
}
