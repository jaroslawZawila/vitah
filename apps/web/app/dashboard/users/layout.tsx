import ClientMessages from "@/i18n/ClientMessages";

/** The translations Usuarios adds for its client components (i18n/client-messages.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages scope="dashboard/users">{children}</ClientMessages>;
}
