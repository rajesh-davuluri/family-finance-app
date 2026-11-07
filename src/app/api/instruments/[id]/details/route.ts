import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { decryptField, encryptField } from "@/lib/encryption";
import { last4Of } from "@/lib/policies";

// An account's reference details: bank, branch, IFSC/routing, customer ID,
// nominee, website, where the login is kept. The full account number is
// stored encrypted and only returned with ?reveal=1.

const text = (max = 200) => z.string().trim().max(max).nullable().optional();
const schema = z.object({
  bankName: text(),
  branch: text(),
  routingCode: text(50),
  // undefined = leave as is, null or "" = remove
  accountNumber: z.string().trim().max(40).nullable().optional(),
  accountHolder: text(),
  customerId: text(100),
  nominee: text(),
  phone: text(50),
  website: text(500),
  loginNote: text(2000),
  notes: text(10000),
});

async function instrumentOf(id: string, householdId: string) {
  const i = await prisma.paymentInstrument.findUnique({ where: { id } });
  return i && i.householdId === householdId ? i : null;
}

function shape(d: Awaited<ReturnType<typeof prisma.accountDetails.findUnique>>, reveal: boolean) {
  if (!d) return null;
  const { accountNumberEncrypted, ...rest } = d;
  let accountNumber: string | null = null;
  if (reveal && accountNumberEncrypted) {
    try {
      accountNumber = decryptField(accountNumberEncrypted);
    } catch {
      accountNumber = null;
    }
  }
  return { ...rest, hasAccountNumber: !!accountNumberEncrypted, accountNumber };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await instrumentOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const reveal = new URL(req.url).searchParams.get("reveal") === "1";
  const details = await prisma.accountDetails.findUnique({
    where: { instrumentId: id },
  });
  return NextResponse.json(shape(details, reveal), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await instrumentOf(id, user.householdId))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { accountNumber, ...rest } = parsed.data;

  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) data[k] = v ? v : null;
  if (accountNumber !== undefined) {
    if (accountNumber) {
      try {
        data.accountNumberEncrypted = encryptField(accountNumber);
      } catch {
        return NextResponse.json(
          {
            error: "The app's encryption key (FIELD_ENCRYPTION_KEY) isn't set, so the account number can't be saved safely.",
          },
          { status: 500 },
        );
      }
      data.accountNumberLast4 = last4Of(accountNumber);
    } else {
      data.accountNumberEncrypted = null;
      data.accountNumberLast4 = null;
    }
  }

  const saved = await prisma.accountDetails.upsert({
    where: { instrumentId: id },
    create: { ...data, instrumentId: id },
    update: data,
  });
  return NextResponse.json(shape(saved, false));
}
