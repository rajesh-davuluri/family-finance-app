import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { balanceItems } from "@/lib/balanceCalculations";

// What the account's balance adds on top of its starting balance: the
// transactions and transfers dated on or after ?since (default: the saved
// starting balance date). The accounts page shows it under the balance, and
// live while the starting balance is being edited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const instrument = await prisma.paymentInstrument.findUnique({ where: { id } });
  if (!instrument || instrument.householdId !== user.householdId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const param = new URL(req.url).searchParams.get("since");
  const since = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : instrument.openingBalanceDate?.toISOString().slice(0, 10);
  if (!since) return NextResponse.json({ since: null, items: [], total: 0 });
  const items = await balanceItems(id, new Date(`${since}T00:00:00Z`));
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return NextResponse.json({ since, items: items.slice(0, 200), count: items.length, total });
}
