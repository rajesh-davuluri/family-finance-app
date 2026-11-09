import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Currency } from "@/lib/enums";
import { describeExisting, findExistingDuplicate } from "@/lib/duplicateData";
import { notifyHousehold } from "@/lib/notify";
import { inferGroup } from "@/lib/categoryGroups";
import { NEW_PREFIX } from "@/lib/receiptItems";

// Saves one bill split across categories (a Costco trip: groceries +
// clothing + household) as linked transactions that add up to the charge.
// Either a new bill, or an existing transaction -- typically the card
// statement's "COSTCO $73.26" -- which becomes the first part, so nothing is
// recorded twice. Also remembers which category each receipt item went to.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  transactionId: z.string().optional(),
  date: DATE,
  instrumentId: z.string().min(1),
  currency: Currency,
  notes: z.string().max(500).nullable().optional(),
  parts: z.array(z.object({ categoryId: z.string().min(1), amount: z.number().positive() })).min(1).max(12),
  items: z.array(z.object({ key: z.string().min(1).max(100), categoryId: z.string().min(1) })).max(300).optional(),
  allowDuplicate: z.boolean().optional(),
});

const cents = (n: number) => Math.round(n * 100);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the amounts and categories." }, { status: 400 });
  const data = parsed.data;
  const householdId = user.householdId;

  const instrument = await prisma.paymentInstrument.findUnique({ where: { id: data.instrumentId } });
  if (!instrument || instrument.householdId !== householdId) return NextResponse.json({ error: "Invalid payment instrument." }, { status: 400 });

  // Categories: the household's own expense categories, or new ones by name
  // ("new:Clothing"), found or created.
  const wanted = Array.from(new Set([...data.parts.map((p) => p.categoryId), ...(data.items ?? []).map((i) => i.categoryId)]));
  const existingCats = await prisma.transactionCategory.findMany({ where: { householdId } });
  const resolved = new Map<string, string>();
  for (const id of wanted) {
    if (!id.startsWith(NEW_PREFIX)) {
      const c = existingCats.find((x) => x.id === id);
      if (!c || c.direction !== "EXPENSE") return NextResponse.json({ error: "One of the categories isn't an expense category here." }, { status: 400 });
      resolved.set(id, c.id);
      continue;
    }
    const name = id.slice(NEW_PREFIX.length).trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "A new category needs a name." }, { status: 400 });
    const same = existingCats.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (same.direction !== "EXPENSE") return NextResponse.json({ error: `"${name}" is an income category.` }, { status: 400 });
      resolved.set(id, same.id);
      continue;
    }
    const created = await prisma.transactionCategory.create({
      data: { name, direction: "EXPENSE", kind: "SPENDING", group: inferGroup(name, "SPENDING"), householdId },
    });
    existingCats.push(created);
    resolved.set(id, created.id);
  }

  // Parts in the same category become one part.
  const merged = new Map<string, number>();
  for (const p of data.parts) {
    const id = resolved.get(p.categoryId)!;
    merged.set(id, (merged.get(id) ?? 0) + cents(p.amount));
  }
  const parts = [...merged.entries()].map(([categoryId, c]) => ({ categoryId, amount: c / 100 })).sort((a, b) => b.amount - a.amount);
  const totalCents = parts.reduce((t, p) => t + cents(p.amount), 0);
  const total = totalCents / 100;
  const groupId = parts.length > 1 ? randomUUID() : null;

  let ids: string[];
  if (data.transactionId) {
    // Splitting a transaction already here (perhaps already split).
    const tx = await prisma.transaction.findUnique({ where: { id: data.transactionId }, include: { category: true, attachment: { select: { id: true } } } });
    if (!tx || tx.householdId !== householdId) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    if (tx.category.direction !== "EXPENSE") return NextResponse.json({ error: "Only spending can be split by category." }, { status: 400 });
    const siblings = tx.splitGroupId
      ? await prisma.transaction.findMany({ where: { splitGroupId: tx.splitGroupId, id: { not: tx.id } }, include: { attachment: { select: { id: true } } } })
      : [];
    const charge = cents(Number(tx.amount)) + siblings.reduce((t, s) => t + cents(Number(s.amount)), 0);
    if (charge !== totalCents) {
      return NextResponse.json({ error: `The parts add up to ${(totalCents / 100).toFixed(2)}, but the charge is ${(charge / 100).toFixed(2)}.` }, { status: 400 });
    }
    const photoOnSibling = !tx.attachment ? siblings.find((s) => s.attachment) : undefined;
    ids = await prisma.$transaction(async (db) => {
      // Keep the bill photo with the part that stays.
      if (photoOnSibling) await db.transactionAttachment.update({ where: { transactionId: photoOnSibling.id }, data: { transactionId: tx.id } });
      if (siblings.length) await db.transaction.deleteMany({ where: { id: { in: siblings.map((s) => s.id) } } });
      await db.transaction.update({ where: { id: tx.id }, data: { amount: parts[0].amount, categoryId: parts[0].categoryId, splitGroupId: groupId } });
      const more = [];
      for (const p of parts.slice(1)) {
        const created = await db.transaction.create({
          data: {
            amount: p.amount,
            categoryId: p.categoryId,
            splitGroupId: groupId,
            currency: tx.currency,
            date: tx.date,
            notes: tx.notes,
            source: tx.source,
            importBatchId: tx.importBatchId,
            instrumentId: tx.instrumentId,
            householdId,
            createdById: tx.createdById,
          },
        });
        more.push(created.id);
      }
      return [tx.id, ...more];
    });
  } else {
    if (instrument.archived) return NextResponse.json({ error: "That payment instrument is archived." }, { status: 400 });
    if (!data.allowDuplicate) {
      const dup = await findExistingDuplicate(householdId, {
        date: data.date,
        amount: total,
        currency: data.currency,
        instrumentId: data.instrumentId,
        notes: data.notes ?? null,
        source: "MANUAL",
      });
      if (dup && dup.match.confidence === "HIGH") {
        return NextResponse.json(
          { error: "This looks like it's already recorded.", duplicate: { ...describeExisting(dup.existing), reason: dup.match.reason } },
          { status: 409 },
        );
      }
    }
    ids = await prisma.$transaction(
      parts.map((p) =>
        prisma.transaction.create({
          data: {
            source: "MANUAL",
            amount: p.amount,
            categoryId: p.categoryId,
            splitGroupId: groupId,
            currency: data.currency,
            date: new Date(`${data.date}T00:00:00Z`),
            notes: data.notes || null,
            instrumentId: data.instrumentId,
            householdId,
            createdById: user.id,
          },
          select: { id: true },
        }),
      ),
    ).then((rows) => rows.map((r) => r.id));
  }

  // Remember each item's category for the next bill.
  const learned = new Map<string, string>();
  for (const i of data.items ?? []) learned.set(i.key, resolved.get(i.categoryId) ?? i.categoryId);
  if (learned.size) {
    await prisma.$transaction(
      [...learned.entries()].map(([itemKey, categoryId]) =>
        prisma.itemCategoryRule.upsert({
          where: { householdId_itemKey: { householdId, itemKey } },
          create: { householdId, itemKey, categoryId },
          update: { categoryId },
        }),
      ),
    );
  }

  const names = parts.map((p) => existingCats.find((c) => c.id === p.categoryId)?.name ?? "").join(", ");
  await notifyHousehold(
    householdId,
    user.id,
    data.transactionId
      ? `${user.name} split a ${data.currency} ${total.toFixed(2)} charge on ${instrument.name} into ${names}`
      : `${user.name} added a ${data.currency} ${total.toFixed(2)} bill on ${instrument.name}, split into ${names}`,
  );

  return NextResponse.json({ primaryId: ids[0], ids, total }, { status: 201 });
}
