import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import StatusNotice from "./StatusNotice";

/**
 * "No encontrado" (`notFound()`, or an address that leads nowhere) and "No
 * tienes permiso" (`forbidden()` in lib/access.ts): what it is, and the way
 * back to Proyectos.
 */
export default async function UnavailableNotice({ kind = "notFound", page = false }: { kind?: "notFound" | "forbidden"; page?: boolean }) {
  const [t, login] = await Promise.all([getTranslations("errorPages"), getTranslations("login")]);
  return (
    <StatusNotice
      eyebrow={t(`${kind}.eyebrow`)}
      title={t(`${kind}.title`)}
      text={t(`${kind}.text`)}
      page={page}
      descriptor={page ? login("descriptor") : undefined}
    >
      <Link href="/dashboard/projects" className={buttonVariants()}>
        {t("toProjects")}
      </Link>
    </StatusNotice>
  );
}
