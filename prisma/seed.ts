import { prisma } from "../src/lib/prisma";

// Unlike the previous version of this app, default categories are created
// automatically per-household at signup (see /api/auth/signup), so there's
// no shared reference data that needs seeding up front. This script is kept
// as a connectivity sanity check and a place to add demo data later if
// you want one for local testing.
async function main() {
  const householdCount = await prisma.household.count();
  console.log(`Database connection OK. ${householdCount} household(s) currently exist.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
