import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Import history for the household, newest first -- powers the "Last import"
// summary and the history table on the Import page.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const batches = await prisma.importBatch.findMany({
    where: { householdId: user.householdId },
    include: { instrument: { select: { name: true } }, createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      currency: b.currency,
      rowsInFile: b.rowsInFile,
      importedCount: b.importedCount,
      duplicateCount: b.duplicateCount,
      periodStart: b.periodStart?.toISOString() ?? null,
      periodEnd: b.periodEnd?.toISOString() ?? null,
      instrumentName: b.instrument.name,
      createdByName: b.createdBy.name,
      createdAt: b.createdAt.toISOString(),
    }))
  );
}
