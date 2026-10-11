import { auth } from "./auth";
import { NextResponse } from "next/server";

export default auth(() => {
  return NextResponse.next();
});

export const config = {
  matcher: [
    // .well-known/workflow: the Workflow SDK's own routes (the budget's AI run).
    "/((?!api/auth|api/mobile|api/v1|_next/static|_next/image|_vercel|\\.well-known/workflow/|favicon\\.ico).*)",
  ],
};
