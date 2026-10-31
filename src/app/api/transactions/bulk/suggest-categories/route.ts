import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { suggestCategories } from "@/lib/categorize";

// Category suggestions for the rows of a CSV about to be imported -- see
// src/lib/categorize.ts for how they're learned.

const schema = z.object({
  descriptions: z.array(z.string().max(1000)).min(1).max(1000),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const suggestions = await suggestCategories(user.householdId, parsed.data.descriptions);
  return NextResponse.json({ suggestions });
}
