import { searchPriceBase } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET ?q=&chapter= → the FRAMER 2026 price base entries matching every word.

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withContext(request, async () =>
    searchPriceBase(params.get("q") ?? "", { chapter: params.get("chapter") ?? undefined, limit: 50 }),
  );
}
