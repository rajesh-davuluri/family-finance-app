// The cron routes need CRON_SECRET as a bearer token when it's set; Vercel
// Cron sends it automatically.
export function cronAuthorized(req: Request) {
  return !process.env.CRON_SECRET || req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}
