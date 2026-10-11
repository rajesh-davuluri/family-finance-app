import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { extractPdfLines } from "@/lib/pdfText";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

// Accepts a credit card statement PDF and returns its text, one entry per
// visual line. The file is read in memory only -- it is never written to
// disk or the database. Turning those lines into transactions happens in
// the browser (src/lib/statementParser.ts) so the person can re-parse with
// a different date order without uploading again.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Choose a PDF statement to upload." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That PDF is larger than 10 MB." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF statements can be uploaded." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the file's actual signature too, not just its name or the type
  // the browser claims -- a renamed CSV or image gets rejected here.
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "That file isn't a valid PDF." }, { status: 400 });
  }

  try {
    const { lines, pageCount } = await extractPdfLines(bytes);
    return NextResponse.json({ lines, pageCount });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "PasswordException") {
      return NextResponse.json(
        { error: "This PDF is password-protected. Open it, save/print an unlocked copy, and upload that instead." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Couldn't read that PDF." }, { status: 400 });
  }
}
