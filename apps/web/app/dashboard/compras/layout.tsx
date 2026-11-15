import ClientMessages from "@/i18n/ClientMessages";

/** The translations the company-wide Compras adds for its client components (i18n/client-messages.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages scope="dashboard/compras">{children}</ClientMessages>;
}
