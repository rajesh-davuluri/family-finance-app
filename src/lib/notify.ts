import { prisma } from "@/lib/prisma";

// Notifies every OTHER member of the household -- never the person who
// triggered the action, since you don't need to be told about your own
// transaction. Best-effort: a notification failure should never block the
// actual transaction/transfer from succeeding, so callers fire this and
// don't await-block the response on it failing.
export async function notifyHousehold(householdId: string, actingUserId: string, message: string) {
  try {
    const others = await prisma.user.findMany({
      where: { householdId, id: { not: actingUserId } },
      select: { id: true },
    });
    if (others.length === 0) return;
    await prisma.notification.createMany({
      data: others.map((u) => ({ householdId, userId: u.id, message })),
    });
  } catch (err) {
    console.error("notifyHousehold failed:", err);
  }
}
