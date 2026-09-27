import { isAwaitingPayment, type Hito, type MobileObra, type MobilePhase } from "@repo/core/contract";
import type { Translate } from "./i18n";

// Reading the obra the way the app shows it (doc/mobile-app-design A-Progress,
// A-Fase, A-Obra-Pagos, A-Hito).

/** The phase under way (its position), or the last one once all are done. */
export function currentPhaseIndex(obra: MobileObra): number {
  const index = obra.phases.findIndex((phase) => phase.key === obra.currentPhaseKey);
  return index === -1 ? obra.phases.length - 1 : index;
}

/** A phase's name: the hito's, or "Proyecto y licencia" for the pre-construction steps. */
export function phaseName(phase: MobilePhase, t: Translate): string {
  return phase.name ?? t("obra.prePhase");
}

/** The payment the client owes next. */
export function nextPayment(obra: MobileObra): Hito | undefined {
  return obra.hitos.find((h) => isAwaitingPayment(h.status));
}

/** How many of the hitos are paid. */
export const paidCount = (obra: MobileObra) => obra.hitos.filter((h) => h.status === "paid").length;
