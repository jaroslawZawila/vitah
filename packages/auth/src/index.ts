import "./types";
import NextAuth, { AuthError, CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { portalCredentials } from "@repo/core";
import { logError } from "@repo/core/log";
import { attemptSignIn, clientIp } from "./credentials";
import { refreshSessionToken, signedInToken } from "./session";

export { AuthError } from "next-auth";

/** Sign-in refused by login throttling (see ./credentials.ts). */
export class TooManyAttempts extends CredentialsSignin {
  code = "too_many_attempts";
}

/** The password was right; the account's two-step verification code is still to come (see ./credentials.ts). */
export class MfaRequired extends CredentialsSignin {
  code = "mfa_required";
}

/** The password was right; the two-step verification code was not. */
export class InvalidMfaCode extends CredentialsSignin {
  code = "invalid_code";
}

/** What actually failed: Auth.js wraps an error thrown inside it as its own error's `cause.err`. */
function underlying(error: Error): Error {
  const wrapped = (error.cause as { err?: unknown } | undefined)?.err;
  return wrapped instanceof Error ? wrapped : error;
}

const result = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Two-step verification: the authenticator's code or a recovery code, sent
        // with the email and the password once the first try answered `mfa_required`.
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials, request) {
        const { email, password, code } = portalCredentials(credentials);
        if (!email || !password) return null;

        const user = await attemptSignIn(email, password, "portal", clientIp(request), code);
        if (user === "too_many_attempts") throw new TooManyAttempts();
        if (user === "mfa_required") throw new MfaRequired();
        if (user === "invalid_code") throw new InvalidMfaCode();
        return user;
      },
    }),
  ],
  // Signed out after a week without using the portal.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: {
    signIn: "/",
  },
  logger: {
    // Auth.js reports every refused sign-in here as an error. Being asked for
    // the code is a step of signing in with two-step verification, not a
    // fault: it must not write an error line per sign-in. The rest is logged
    // as the portal logs everything (@repo/core/log: one JSON line, no e-mail).
    error(error) {
      if (error instanceof MfaRequired) return;
      logError("auth.error", underlying(error), { type: error instanceof AuthError ? error.type : error.name });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      return user ? signedInToken(token, user) : refreshSessionToken(token);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
        session.user.mfa = token.mfa === true;
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
