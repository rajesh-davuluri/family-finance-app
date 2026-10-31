import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { merchantKeys } from "@/lib/merchantKey";

// Suggests a category for each description in a CSV about to be imported,
// learned from the household's own past transactions: "SWIGGY BANGALORE"
// gets whatever category earlier SWIGGY transactions were given. Nothing is
// stored -- every import (and every correction made in its preview) simply
// becomes more history to learn from.

const schema = z.object({
  descriptions: z.array(z.string().max(1000)).min(1).max(1000),
});

// How much history to learn from. Recent transactions matter most, and this
// keeps the query cheap for a household's ledger.
const HISTORY_LIMIT = 5000;

// The most recent transaction for a merchant counts this much extra, so
// changing a merchant's category once is enough to change future suggestions.
const MOST_RECENT_BONUS = 2;

// A merchant-only (single-word) key is looser, e.g. "BLUE" from "BLUE
// BOTTLE" -- only trust it when past transactions mostly agree.
const LOOSE_KEY_MIN_SHARE = 0.6;

type Votes = Map<string, number>; // categoryId -> score

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const history = await prisma.transaction.findMany({
    where: { householdId: user.householdId, notes: { not: null } },
    select: { notes: true, categoryId: true },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  // key -> votes per category. History is newest-first, so the first
  // transaction seen for a key is its most recent one.
  const votesByKey = new Map<string, Votes>();
  for (const t of history) {
    for (const key of merchantKeys(t.notes)) {
      let votes = votesByKey.get(key);
      const isMostRecent = !votes;
      if (!votes) {
        votes = new Map();
        votesByKey.set(key, votes);
      }
      votes.set(t.categoryId, (votes.get(t.categoryId) ?? 0) + 1 + (isMostRecent ? MOST_RECENT_BONUS : 0));
    }
  }

  function best(votes: Votes) {
    let top: string | null = null;
    let topScore = 0;
    let total = 0;
    for (const [categoryId, score] of votes) {
      total += score;
      if (score > topScore) {
        top = categoryId;
        topScore = score;
      }
    }
    return top ? { categoryId: top, share: topScore / total } : null;
  }

  const suggestions = parsed.data.descriptions.map((d) => {
    const keys = merchantKeys(d);
    for (const [i, key] of keys.entries()) {
      const votes = votesByKey.get(key);
      if (!votes) continue;
      const pick = best(votes);
      if (!pick) continue;
      const isLooseKey = keys.length > 1 && i === keys.length - 1;
      if (isLooseKey && pick.share < LOOSE_KEY_MIN_SHARE) continue;
      return { categoryId: pick.categoryId, matchedOn: key };
    }
    return null;
  });

  return NextResponse.json({ suggestions });
}
