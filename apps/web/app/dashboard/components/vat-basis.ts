import { useTranslations } from "next-intl";

/**
 * Which VAT a money figure is in: `excl` without it (budget, cost, orders and
 * what is compared with them), `incl` with it (what Administration pays).
 */
export type VatBasis = "excl" | "incl";

/**
 * The portal's one way to say it: a money card's or total's label with its
 * basis after it, "Venta · sin IVA", "Por pagar · IVA incl.".
 */
export function useVatLabel() {
  const t = useTranslations("vatBasis");
  return (label: string, basis: VatBasis) => t(basis, { label });
}
