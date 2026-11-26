import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Receipt items the household has sorted before (itemKey -> categoryId), so
// a scanned bill puts them in the same category again.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rules = await prisma.itemCategoryRule.findMany({
    where: { householdId: user.householdId },
    select: { itemKey: true, categoryId: true },
  });
  return NextResponse.json({ rules: Object.fromEntries(rules.map((r) => [r.itemKey, r.categoryId])) });
}
