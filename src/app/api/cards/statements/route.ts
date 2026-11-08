import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  instrumentId: z.string().min(1),
  closingDate: DATE,
  balance: z.number().finite(),
  minimumDue: z.number().min(0).nullable().optional(),
  dueDate: DATE.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const at = (d: string) => new Date(`${d}T00:00:00Z`);

// Record a statement as printed. Typing in the same closing date again
// replaces it, so a correction is just entering it again.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the dates and amounts." }, { status: 400 });
  const { instrumentId, closingDate, balance, minimumDue, dueDate, notes } = parsed.data;

  const card = await prisma.paymentInstrument.findUnique({ where: { id: instrumentId } });
  if (!card || card.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (card.type !== "CREDIT_CARD") return NextResponse.json({ error: "Statements are for credit cards." }, { status: 400 });
  if (dueDate && dueDate < closingDate) return NextResponse.json({ error: "The due date comes after the closing date." }, { status: 400 });

  const data = { balance, minimumDue: minimumDue ?? null, dueDate: dueDate ? at(dueDate) : null, notes: notes?.trim() || null };
  const saved = await prisma.cardStatement.upsert({
    where: { instrumentId_closingDate: { instrumentId, closingDate: at(closingDate) } },
    create: { instrumentId, closingDate: at(closingDate), ...data },
    update: data,
  });
  // The first statement typed in also sets the card's closing and due days.
  if (card.statementDay === null || (card.dueDay === null && dueDate)) {
    await prisma.paymentInstrument.update({
      where: { id: card.id },
      data: {
        ...(card.statementDay === null ? { statementDay: Number(closingDate.slice(8)) } : {}),
        ...(card.dueDay === null && dueDate ? { dueDay: Number(dueDate.slice(8)) } : {}),
      },
    });
  }
  return NextResponse.json({ id: saved.id });
}
