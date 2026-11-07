import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { policyOf } from "@/lib/policyData";

async function documentOf(policyId: string, docId: string, householdId: string) {
  if (!(await policyOf(policyId, householdId))) return null;
  const doc = await prisma.policyDocument.findUnique({ where: { id: docId } });
  return doc && doc.policyId === policyId ? doc : null;
}

// Opens the file in the browser (PDFs and images display inline).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const doc = await documentOf(id, docId, user.householdId);
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await documentOf(id, docId, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.policyDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
