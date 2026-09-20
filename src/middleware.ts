export { default } from "next-auth/middleware";

export const config = {
  // Everything except auth pages, auth API routes, and static assets
  // requires a signed-in session.
  matcher: [
    "/dashboard/:path*",
    "/transactions/:path*",
    "/budgets/:path*",
    "/goals/:path*",
    "/net-worth/:path*",
    "/debts/:path*",
    "/instruments/:path*",
    "/categories/:path*",
    "/import/:path*",
    "/recurring/:path*",
    "/household/:path*",
    "/settings/:path*",
  ],
};
