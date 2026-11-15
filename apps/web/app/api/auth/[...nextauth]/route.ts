import { handlers } from "../../../../auth";
import { withApiPolicy } from "../../../../lib/responses";

// Auth.js answers JSON (session, CSRF token), redirects and a few plain pages
// (error, sign-out): each gets the API's policy for its kind (lib/responses.ts).
export const GET = withApiPolicy(handlers.GET);
export const POST = withApiPolicy(handlers.POST);
