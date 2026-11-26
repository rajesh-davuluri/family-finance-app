import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// The photo of a bill or receipt behind one transaction: PUT the image bytes
// (the phone sends a downscaled JPEG), GET it back, DELETE it.

const MAX_BYTES = 3 * 1024 * 1024;

// Only real images are kept and served back -- checked by their first bytes,
// not just the declared type.
function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function ownTransaction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const t = await prisma.transaction.findUnique({ where: { id }, select: { householdId: true } });
  if (!t || t.householdId !== user.householdId) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return { user };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownTransaction(id);
  if (own.error) return own.error;
  const a = await prisma.transactionAttachment.findUnique({ where: { transactionId: id } });
  if (!a) return NextResponse.json({ error: "No photo." }, { status: 404 });
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.contentType,
      "Content-Length": String(a.size),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownTransaction(id);
  if (own.error) return own.error;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: "That photo is too large (3 MB at most)." }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "No photo received." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "That photo is too large (3 MB at most)." }, { status: 413 });
  const type = imageType(bytes);
  if (!type) return NextResponse.json({ error: "Only JPEG, PNG or WebP photos can be attached." }, { status: 415 });

  const data = { contentType: type, size: bytes.length, data: Buffer.from(bytes) };
  await prisma.transactionAttachment.upsert({ where: { transactionId: id }, create: { transactionId: id, ...data }, update: data });
  return NextResponse.json({ ok: true, size: bytes.length });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownTransaction(id);
  if (own.error) return own.error;
  await prisma.transactionAttachment.deleteMany({ where: { transactionId: id } });
  return NextResponse.json({ ok: true });
}
