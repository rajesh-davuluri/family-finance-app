import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { TransactionDirection } from "@/lib/enums";
import { CategoryKind, isKindAllowed, kindOf } from "@/lib/categoryKind";
import { CategoryGroup, groupOf } from "@/lib/categoryGroups";

const createSchema = z.object({
  name: z.string().min(1),
  direction: TransactionDirection,
  kind: CategoryKind.optional(),
  group: CategoryGroup.optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const categories = await prisma.transactionCategory.findMany({
    where: { householdId: user.householdId },
    orderBy: [{ direction: "asc" }, { name: "asc" }],
  });
  // effectiveKind is the stored kind, or the guess from the name when none
  // has been chosen yet.
  return NextResponse.json(
    categories.map((c) => ({
      ...c,
      effectiveKind: kindOf(c),
      kindGuessed: !c.kind,
      effectiveGroup: groupOf(c),
      groupGuessed: !c.group,
    }))
  );
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.kind && !isKindAllowed(parsed.data.kind, parsed.data.direction)) {
    return NextResponse.json({ error: "That type doesn't fit an income/expense category." }, { status: 400 });
  }

  const existing = await prisma.transactionCategory.findFirst({
    where: { householdId: user.householdId, name: parsed.data.name },
  });
  if (existing) return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });

  const category = await prisma.transactionCategory.create({
    data: { ...parsed.data, householdId: user.householdId },
  });
  return NextResponse.json(category, { status: 201 });
}
