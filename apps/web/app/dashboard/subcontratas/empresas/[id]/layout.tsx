import ClientMessages from "@/i18n/ClientMessages";

/** The translations a company's ficha adds for its client components (i18n/client-messages.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages scope="dashboard/subcontratas/empresas/[id]">{children}</ClientMessages>;
}
