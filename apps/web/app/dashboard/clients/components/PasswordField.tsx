"use client";

import { useTranslations } from "next-intl";
import NewPasswordField from "../../components/NewPasswordField";

/** The password a client signs in to the app with: the one policy, and how to hand it over. */
export default function PasswordField({ label }: { label: string }) {
  const t = useTranslations("clientsPage.form");
  return <NewPasswordField label={label} hint={t("passwordHint")} />;
}
