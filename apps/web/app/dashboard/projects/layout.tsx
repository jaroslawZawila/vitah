import ClientMessages from "@/i18n/ClientMessages";

/** The translations Proyectos (the list, a new project and each project's tabs) adds for its client components (i18n/client-messages.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages scope="dashboard/projects">{children}</ClientMessages>;
}
