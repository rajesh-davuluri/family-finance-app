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

        // A database outage (e.g. a paused Azure SQL instance or a firewall
        // change) used to surface as "Incorrect email or password" -- report
        // it separately so the login page can say the server is the problem.
        let user;
        try {
          // Select only what sign-in needs, so a column added later (e.g. the
          // login-time fields, if their migration hasn't run yet) can never
          // stop people from logging in.
          user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
            select: {
              id: true,
              email: true,
              name: true,
              passwordHash: true,
              householdId: true,
              role: true,
              mfaEnabled: true,
              mfaSecretEncrypted: true,
            },
          });
        } catch (err) {
          console.error("Login failed: couldn't query the database", err);
          throw new Error("SERVER_UNAVAILABLE");
        }
        if (!user) return null;

        const validPassword = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!validPassword) return null;

        if (user.mfaEnabled) {
          if (!user.mfaSecretEncrypted) {
            // Shouldn't happen, but fail closed rather than skip MFA.
            throw new Error("MFA_REQUIRED");
          }
          let secret;
          try {
            secret = decryptField(user.mfaSecretEncrypted);
          } catch (err) {
            // Usually FIELD_ENCRYPTION_KEY is missing or was changed.
            console.error("Login failed: couldn't decrypt MFA secret", err);
            throw new Error("SERVER_UNAVAILABLE");
          }
          const validToken = credentials.totp && authenticator.verify({ token: credentials.totp, secret });
          if (!validToken) {
            throw new Error("MFA_REQUIRED");
          }
        }

        // Record the sign-in. A failure here shouldn't block logging in.
        try {
          const { lastLoginAt } = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: { lastLoginAt: true },
          });
          await prisma.user.update({
            where: { id: user.id },
            data: { previousLoginAt: lastLoginAt, lastLoginAt: new Date() },
            select: { id: true },
          });
        } catch (err) {
          console.error("Couldn't record login time", err);
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
