import { auth } from "./auth";
import { NextResponse } from "next/server";

export default auth(() => {
  return NextResponse.next();
});

export const config = {
  matcher: [
    // .well-known/workflow: the Workflow SDK's own routes (the budget's AI run).
    // api/health: the uptime check, which has no session (app/api/health/route.ts).
    "/((?!api/auth|api/mobile|api/v1|api/health$|_next/static|_next/image|_vercel|\\.well-known/workflow/|favicon\\.ico).*)",
  ],
};
