import { contactService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// The office the client's app shows on Contacto.
// GET /api/v1/tenant/contact → OfficeContact { address, phone, email, hours } (any staff role)
// PUT /api/v1/tenant/contact  body: the four fields (one not sent is cleared) → OfficeContact (admins only)

export function GET(request: Request) {
  return withContext(request, (ctx) => contactService.getOfficeContact(ctx));
}

export function PUT(request: Request) {
  return withContext(request, async (ctx) => contactService.updateOfficeContact(ctx, await readJson(request)));
}
