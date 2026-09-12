import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      householdId: string;
      role: string;
      name?: string | null;
      email?: string | null;
    };
  }
}
