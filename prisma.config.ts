import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma CLI commands (migrate, studio, generate, db seed, etc.) don't
// auto-load .env the way `next dev` does — this file is what makes
// DATABASE_URL visible to them. The app itself (the Next.js server) still
// reads .env on its own via Next's built-in dotenv support.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
