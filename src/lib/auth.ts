import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/encryption";

// Sign-in is a single form with three fields: email, password, and an
// optional totp code. If the account has MFA enabled and no/invalid code is
// given, authorize() throws "MFA_REQUIRED" so the login page can reveal a
// TOTP input and let the person resubmit with the code, without a second
// separate auth round-trip.
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user) return null;

        const validPassword = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!validPassword) return null;

        if (user.mfaEnabled) {
          if (!user.mfaSecretEncrypted) {
            // Shouldn't happen, but fail closed rather than skip MFA.
            throw new Error("MFA_REQUIRED");
          }
          const secret = decryptField(user.mfaSecretEncrypted);
          const validToken = credentials.totp && authenticator.verify({ token: credentials.totp, secret });
          if (!validToken) {
            throw new Error("MFA_REQUIRED");
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          householdId: user.householdId,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.householdId = (user as any).householdId;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).householdId = token.householdId;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};
