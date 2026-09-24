import "./types";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "./credentials";

export { AuthError } from "next-auth";

const result = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        return verifyCredentials(email, password, "portal");
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.tenantId = user.tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
      }
      return session;
    },
    authorized({ auth: session, request: { nextUrl } }) {
      const isAuthenticated = !!session?.user;
      const isLoginPage = nextUrl.pathname === "/";
      const isAuthApi = nextUrl.pathname.startsWith("/api/auth");
      // Mobile and v1 API routes authenticate per request (Bearer token or
      // session) and must answer 401 JSON rather than redirect to the login page.
      const isPublicApi =
        nextUrl.pathname.startsWith("/api/mobile") ||
        nextUrl.pathname.startsWith("/api/v1");

      if (isAuthApi || isPublicApi) return true;

      if (isLoginPage) {
        if (isAuthenticated) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }

      return isAuthenticated;
    },
  },
});

export const handlers = result.handlers;
export const auth = result.auth;
export const signIn = result.signIn;
export const signOut = result.signOut;
