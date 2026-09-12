export { default } from "next-auth/middleware";

export const config = {
  // Everything except auth pages, auth API routes, and static assets
  // requires a signed-in session.
  matcher: [
    "/dashboard/:path*",
    "/transactions/:path*",
    "/instruments/:path*",
    "/categories/:path*",
    "/recurring/:path*",
    "/household/:path*",
    "/settings/:path*",
  ],
};
