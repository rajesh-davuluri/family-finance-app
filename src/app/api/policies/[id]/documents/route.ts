import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { policyOf } from "@/lib/policyData";
import { MAX_DOCUMENT_BYTES } from "@/lib/policies";

const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp|heic|heif))$/;

// Upload a file (the policy bond, a premium receipt...) to keep with the policy.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await policyOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (!ALLOWED.test(file.type)) return NextResponse.json({ error: "Only PDF or image files (PNG, JPG, HEIC)." }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: "That file is over 4 MB." }, { status: 400 });

  const doc = await prisma.policyDocument.create({
    data: {
      policyId: id,
      fileName: file.name.slice(0, 255) || "document",
      contentType: file.type,
      size: file.size,
      data: Buffer.from(await file.arrayBuffer()),
      uploadedById: user.id,
    },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      size: true,
      createdAt: true,
    },
  });
  return NextResponse.json(doc, { status: 201 });
}
