import { useFormatter, useTranslations } from "next-intl";
import {
  requirement,
  type AccessReason,
  type CompanyStatus,
  type DocState,
  type SubcontractorKind,
  type WorkerAccessStatus,
} from "@repo/core/contract";
import type { badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

// Pure helpers shared by the Subcontratas views: badge tones, names, dates, URLs.

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export const DOC_STATE_VARIANT: Record<DocState, BadgeVariant> = {
  missing: "yel",
  requested: "yel",
  uploaded: "info",
  rejected: "destructive",
  not_applicable: "outline",
  validated: "good",
  expiring: "warn",
  expired: "destructive",
};

export const COMPANY_STATUS_VARIANT: Record<CompanyStatus, BadgeVariant> = {
  apta: "good",
  pendiente: "yel",
  bloqueada: "destructive",
};

export const ACCESS_VARIANT: Record<WorkerAccessStatus, BadgeVariant> = {
  ok: "good",
  pending: "yel",
  blocked: "destructive",
};

/** Calendar date (YYYY-MM-DD) → Date at UTC midnight, for formatting. */
export function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Formats calendar dates (YYYY-MM-DD) and timestamps as dd/mm/yyyy. */
export function useDates() {
  const format = useFormatter();
  const date = (value: string | null | undefined) =>
    value
      ? format.dateTime(value.length === 10 ? calendarDate(value) : new Date(value), {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: value.length === 10 ? "UTC" : "Europe/Madrid",
        })
      : "—";
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  return { date, dateTime };
}

/** A requirement's name; the self-employed have RETA documents instead of the company ones. */
export function useRequirementName() {
  const t = useTranslations("subcontractors.requirements");
  return (id: string, kind?: SubcontractorKind) =>
    kind === "self_employed" && (id === "rnt_mensual" || id === "alta_ss") ? t(`${id}.selfEmployed`) : t(`${id}.name`);
}

/** A requirement's legal basis and validity, e.g. "Art. 43.1.f LGT · Validez 12 meses". */
export function useRequirementBasis() {
  const t = useTranslations("subcontractors");
  return (id: string) => {
    const months = requirement(id)?.validityMonths ?? null;
    const validity =
      months === null
        ? t("validity.none")
        : months === 1
          ? t("validity.monthly")
          : months % 12 === 0
            ? t("validity.years", { count: months / 12 })
            : t("validity.months", { count: months });
    return `${t(`requirements.${id}.legal`)} · ${validity}`;
  };
}

/** Why a worker can't enter, in words. */
export function useAccessReason() {
  const t = useTranslations("subcontractors.accessReasons");
  const name = useRequirementName();
  return (reason: AccessReason, kind?: SubcontractorKind) =>
    "requirementId" in reason ? t(reason.code, { document: name(reason.requirementId, kind) }) : t(reason.code);
}

/** A document version's PDF, served by /api/v1 with the session cookie. */
export const versionUrl = (subcontractorId: string, versionId: string) =>
  `/api/v1/subcontractors/${subcontractorId}/versions/${versionId}`;

/** The CAE dossier (ZIP) of every company, one obra's, or one company's. */
export function dossierUrl(options: { projectId?: string | null; subcontractorId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.subcontractorId) params.set("subcontractorId", options.subcontractorId);
  const query = params.toString();
  return `/api/v1/subcontractors/dossier${query ? `?${query}` : ""}`;
}

export const companyHref = (id: string) => `/dashboard/subcontratas/empresas/${id}`;
export const workerHref = (id: string) => `/dashboard/subcontratas/trabajadores/${id}`;
