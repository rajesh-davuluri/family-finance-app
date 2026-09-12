import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Two signup paths, distinguished by whether `inviteCode` is present:
//   - No inviteCode  -> creates a brand-new household, this person becomes ADMIN
//   - inviteCode set -> joins an existing household as a MEMBER
const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  householdName: z.string().min(1).optional(),
  inviteCode: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, email, password, householdName, inviteCode } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (inviteCode) {
    const household = await prisma.household.findUnique({ where: { inviteCode } });
    if (!household) {
      return NextResponse.json({ error: "Invalid invite code." }, { status: 404 });
    }
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: "MEMBER",
        householdId: household.id,
      },
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
  }

  if (!householdName) {
    return NextResponse.json(
      { error: "Provide a householdName to create a new household, or an inviteCode to join one." },
      { status: 400 }
    );
  }

  // Create household + default categories + first (admin) user together.
  const result = await prisma.$transaction(async (tx) => {
    const household = await tx.household.create({ data: { name: householdName } });

    const defaultCategories: { name: string; direction: "INCOME" | "EXPENSE" }[] = [
      { name: "Salary", direction: "INCOME" },
      { name: "Other Income", direction: "INCOME" },
      { name: "Groceries", direction: "EXPENSE" },
      { name: "Rent/Mortgage", direction: "EXPENSE" },
      { name: "Utilities", direction: "EXPENSE" },
      { name: "Dining Out", direction: "EXPENSE" },
      { name: "Transportation", direction: "EXPENSE" },
      { name: "Entertainment", direction: "EXPENSE" },
      { name: "Healthcare", direction: "EXPENSE" },
      { name: "Other Expense", direction: "EXPENSE" },
    ];
    for (const cat of defaultCategories) {
      await tx.transactionCategory.create({
        data: { ...cat, householdId: household.id, isDefault: true },
      });
    }

    const user = await tx.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: "ADMIN",
        householdId: household.id,
      },
    });

    return { household, user };
  });

  return NextResponse.json({ id: result.user.id, householdInviteCode: result.household.inviteCode }, { status: 201 });
}
