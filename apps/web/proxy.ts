import { auth } from "./auth";
import { NextResponse } from "next/server";

export default auth(() => {
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
