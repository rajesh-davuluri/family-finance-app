import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { policyInclude, policyJson, policyOf } from "@/lib/policyData";
import { nextDueAfter } from "@/lib/policies";
import { notifyHousehold } from "@/lib/notify";

// Records a premium paid: an ordinary expense transaction linked to the
// policy, then moves the policy's next due date on by one period (or
// marks premiums done after the last one).
const schema = z.object({
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  instrumentId: z.string(),
  categoryId: z.string(),
  // Advance the next due date (false when recording an old payment).
  advance: z.boolean().default(true),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const policy = await policyOf(id, user.householdId);
  if (!policy) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const [instrument, category] = await Promise.all([
    prisma.paymentInstrument.findUnique({ where: { id: d.instrumentId } }),
    prisma.transactionCategory.findUnique({ where: { id: d.categoryId } }),
  ]);
  if (!instrument || instrument.householdId !== user.householdId) {
    return NextResponse.json({ error: "Pick the account you paid from." }, { status: 400 });
  }
  if (!category || category.householdId !== user.householdId || category.direction !== "EXPENSE") {
    return NextResponse.json({ error: "Pick a money-out category." }, { status: 400 });
  }

  const due = policy.nextDueDate ? policy.nextDueDate.toISOString().slice(0, 10) : null;
  const next = d.advance && due ? nextDueAfter(due, policy.premiumFrequency, policy.premiumEndDate?.toISOString() ?? null) : undefined;
  const label = [policy.insurer, policy.planName].filter(Boolean).join(" ");

  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        amount: d.amount,
        currency: instrument.currency,
        date: new Date(`${d.date}T00:00:00Z`),
        notes: `${label} premium${policy.policyNumber ? ` — policy ${policy.policyNumber}` : ""}`,
        householdId: user.householdId,
        categoryId: category.id,
        instrumentId: instrument.id,
        createdById: user.id,
        source: "MANUAL",
        policyId: policy.id,
      },
    }),
    ...(next !== undefined
      ? [
          prisma.insurancePolicy.update({
            where: { id },
            data: next ? { nextDueDate: new Date(`${next}T00:00:00Z`) } : { nextDueDate: null, status: "PAID_UP" },
          }),
        ]
      : []),
  ]);

  notifyHousehold(user.householdId, user.id, `${user.name} paid the ${label} premium (${instrument.currency} ${d.amount.toFixed(2)})`);

  const updated = await prisma.insurancePolicy.findUniqueOrThrow({
    where: { id },
    include: policyInclude,
  });
  return NextResponse.json(policyJson(updated));
}
