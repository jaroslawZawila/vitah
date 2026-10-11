"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Contact, FolderKanban, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { key: "projects", href: "/dashboard/projects", icon: FolderKanban, adminOnly: false },
  { key: "clients", href: "/dashboard/clients", icon: Contact, adminOnly: true },
  { key: "users", href: "/dashboard/users", icon: UserCog, adminOnly: true },
] as const;

/** Routes under `dashboard/projects/[id]/`, shown nested under "Projects". */
const PROJECT_TABS = [
  { key: "general", path: "" },
  { key: "obra", path: "/obra" },
  { key: "budget", path: "/budget" },
  { key: "payments", path: "/payments" },
  { key: "documents", path: "/documents" },
  { key: "photos", path: "/photos" },
] as const;

/**
 * The grafito rail. From `lg` up it is a sticky column; below, a top bar whose sections and
 * project tabs scroll sideways.
 */
export default function Sidebar({
  name,
  email,
  isAdmin,
}: {
  name: string | null;
  email: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");
  // Only set on `projects/[id]` routes, so not on e.g. `projects/new`.
  const { id: projectId } = useParams<{ id?: string }>();

  return (
    <aside className="flex flex-col gap-3 bg-rail px-4 py-3 text-rail-foreground lg:sticky lg:top-0 lg:h-svh lg:gap-[18px] lg:overflow-y-auto lg:px-3.5 lg:py-[22px]">
      <div className="flex items-center gap-[11px] lg:px-2">
        <div className="grid size-8 flex-none place-items-center rounded-full border-2 border-rail-accent font-heading text-sm font-bold text-rail-accent lg:size-10">
          V
        </div>
        <div>
          <div className="font-heading text-lg leading-none font-bold tracking-[0.16em] text-white lg:text-[21px]">
            ViTAH
          </div>
          <div className="mt-1 text-[10.5px] tracking-[0.14em] text-rail-muted uppercase">
            OS Platform
          </div>
        </div>
        <SignedInUser name={name} email={email} className="ml-auto max-w-[45%] lg:hidden" />
      </div>

      <nav className="-mx-1 flex flex-wrap gap-0.5 lg:mx-0 lg:flex-col lg:flex-nowrap">
        {NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly).map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <div key={item.key} className="max-lg:contents">
              <Link
                href={item.href}
                className={cn(
                  "relative flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-[13.5px] font-medium text-rail-foreground transition-colors hover:bg-white/6 lg:min-h-10 lg:gap-[11px] lg:px-3 lg:text-[14.5px]",
                  active &&
                    "bg-white/8 text-white lg:before:absolute lg:before:inset-y-2 lg:before:-left-3.5 lg:before:w-[3px] lg:before:rounded-r-[3px] lg:before:bg-rail-accent",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn("size-[19px] flex-none opacity-85", active && "text-rail-accent opacity-100")}
                  strokeWidth={1.8}
                />
                {t(item.key)}
              </Link>
              {item.key === "projects" && projectId && active && (
                <ProjectTabs projectId={projectId} pathname={pathname} />
              )}
            </div>
          );
        })}
      </nav>

      <SignedInUser
        name={name}
        email={email}
        className="mt-auto hidden border-t border-white/8 px-2 pt-4 lg:flex"
      />
    </aside>
  );
}

/** Who is signed in: at the foot of the rail on desktop, in the top bar's corner on phones. */
function SignedInUser({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string | null;
  className: string;
}) {
  const displayName = name || email || "";
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div className="grid size-[30px] flex-none place-items-center rounded-full bg-verde-oliva-dark text-[13px] font-bold text-white">
        {displayName.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-white">{displayName}</div>
        {name && email && <div className="truncate text-[11.5px] text-rail-muted">{email}</div>}
      </div>
    </div>
  );
}

function ProjectTabs({ projectId, pathname }: { projectId: string; pathname: string }) {
  const t = useTranslations("sidebar.projectTabs");

  return (
    <ul
      className="order-last -mx-3 flex basis-full gap-1 overflow-x-auto px-3 lg:mx-0 lg:mt-0.5 lg:mb-1.5 lg:ml-[21px] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-l lg:border-white/10 lg:px-0"
      aria-label={t("label")}
    >
      {PROJECT_TABS.map((tab) => {
        const href = `/dashboard/projects/${projectId}${tab.path}`;
        // A tab's own pages (e.g. a chapter under Obra) keep it current.
        const active = pathname === href || (tab.path !== "" && pathname.startsWith(`${href}/`));
        return (
          <li key={tab.key} className="flex-none">
            <Link
              href={href}
              className={cn(
                "flex min-h-11 items-center rounded-full px-3 text-[13px] whitespace-nowrap text-rail-muted transition-colors hover:text-rail-foreground lg:-ml-px lg:min-h-9 lg:rounded-none lg:border-l-2 lg:border-transparent lg:px-3.5 lg:text-[13.5px]",
                active && "bg-white/10 font-semibold text-white lg:border-rail-accent lg:bg-transparent",
              )}
              aria-current={active ? "page" : undefined}
            >
              {t(tab.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
