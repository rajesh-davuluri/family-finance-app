import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { holdingOf } from "@/lib/investmentData";
import { AssetType, Exchange } from "@/lib/investments";
import { deleteHoldingCascade } from "@/lib/cascadeDelete";

const schema = z.object({
  symbol: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().max(200).nullable().optional(),
  exchange: Exchange.optional(),
  assetType: AssetType.optional(),
  sector: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  // A price typed in (e.g. for an unlisted holding, or when fetching fails).
  price: z.number().positive().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await holdingOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { price, symbol, name, sector, notes, ...rest } = parsed.data;
  const holding = await prisma.holding.update({
    where: { id },
    data: {
      ...rest,
      symbol: symbol?.toUpperCase(),
      name: name === undefined ? undefined : name || null,
      sector: sector === undefined ? undefined : sector || null,
      notes: notes === undefined ? undefined : notes || null,
      ...(price ? { lastPrice: price, lastPriceAt: new Date(), priceSource: "MANUAL" } : {}),
    },
  });
  return NextResponse.json(holding);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await holdingOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await deleteHoldingCascade(id);
  return NextResponse.json({ ok: true });
}
