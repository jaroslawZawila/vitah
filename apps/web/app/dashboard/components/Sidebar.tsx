"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Contact, FolderKanban, HardHat, Settings, ShoppingCart, UserCog } from "lucide-react";
import { APP_LANGUAGES, type AppLanguage, type PurchasingCounts, type SubcontractorCounts } from "@repo/core/contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  COMPANY_PURCHASES_HREF,
  INVOICES_HREF,
  PAYMENTS_HREF,
  REQUESTS_HREF,
  SUPPLIERS_HREF,
} from "../projects/[id]/components/purchasing/links";

const NAV_ITEMS = [
  { key: "projects", href: "/dashboard/projects", icon: FolderKanban, adminOnly: false },
  { key: "clients", href: "/dashboard/clients", icon: Contact, adminOnly: true },
  { key: "users", href: "/dashboard/users", icon: UserCog, adminOnly: true },
] as const;

/** Routes under `dashboard/projects/[id]/`, shown nested under "Projects". */
const PROJECT_TABS = [
  { key: "general", path: "" },
  { key: "budget", path: "/budget" },
  { key: "obra", path: "/obra" },
  { key: "purchases", path: "/compras" },
  { key: "payments", path: "/payments" },
  { key: "documents", path: "/documents" },
] as const;

/** Proyectos' sections entered first, the obra picked after (Compras: `projects/compras`). */
const PROJECT_SECTIONS = [{ key: "purchases", href: "/dashboard/projects/compras" }] as const;

const SUBCONTRACTORS_HREF = "/dashboard/subcontratas";

/** The Subcontratas section's pages, nested under it in the rail's "Red" group. */
const SUBCONTRACTOR_TABS = [
  { key: "companies", href: `${SUBCONTRACTORS_HREF}/empresas` },
  { key: "workers", href: `${SUBCONTRACTORS_HREF}/trabajadores` },
  { key: "expiries", href: `${SUBCONTRACTORS_HREF}/empresas#caducidades` },
] as const;

/** Compras' pages, nested under it in the rail's "Red" group. */
const PURCHASE_TABS = [
  { key: "requests", href: REQUESTS_HREF },
  { key: "orders", href: COMPANY_PURCHASES_HREF },
  { key: "invoices", href: INVOICES_HREF },
  { key: "payments", href: PAYMENTS_HREF },
  { key: "suppliers", href: SUPPLIERS_HREF },
] as const;

const navLinkClass = (active: boolean) =>
  cn(
    "relative flex min-h-11 items-center gap-2 rounded-[9px] px-2.5 text-[13.5px] font-medium text-rail-foreground transition-colors hover:bg-white/6 lg:min-h-10 lg:gap-[11px] lg:px-3 lg:text-[14.5px]",
    active &&
      "bg-white/8 text-white lg:before:absolute lg:before:inset-y-2 lg:before:-left-3.5 lg:before:w-[3px] lg:before:rounded-r-[3px] lg:before:bg-rail-accent",
  );

/**
 * The grafito rail. From `lg` up it is a sticky column; below, a top bar whose sections and
 * project tabs scroll sideways.
 */
export default function Sidebar({
  name,
  email,
  isAdmin,
  subcontractors = null,
  purchases = null,
  language,
  onLanguageChange,
}: {
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  /** The Subcontratas badges; null hides them. */
  subcontractors?: SubcontractorCounts | null;
  /** Compras' counts and its badge (invoices due); null hides them. */
  purchases?: PurchasingCounts | null;
  /** The portal's language, the user's setting. */
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => Promise<{ error?: string }>;
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
        <SettingsMenu
          name={name}
          email={email}
          language={language}
          onLanguageChange={onLanguageChange}
          className="ml-auto max-w-[60%] lg:hidden"
        />
      </div>

      <nav className="-mx-1 flex flex-wrap gap-0.5 lg:mx-0 lg:flex-col lg:flex-nowrap">
        {NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly).map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <div key={item.key} className="max-lg:contents">
              <Link href={item.href} className={navLinkClass(active)}>
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
              {item.key === "projects" && !projectId && active && <ProjectSections pathname={pathname} />}
            </div>
          );
        })}
        <SubcontractorsNav pathname={pathname} counts={subcontractors} />
        <PurchasesNav pathname={pathname} counts={purchases} />
      </nav>

      <div className="mt-auto hidden border-t border-white/8 pt-3 lg:block">
        <SettingsMenu
          name={name}
          email={email}
          language={language}
          onLanguageChange={onLanguageChange}
          className="w-full"
        />
      </div>
    </aside>
  );
}

/**
 * Who is signed in, opening their settings (the portal's language, saved on their account): at
 * the foot of the rail on desktop, in the top bar's corner on phones (avatar only below `sm`).
 */
function SettingsMenu({
  name,
  email,
  language,
  onLanguageChange,
  className,
}: {
  name: string | null;
  email: string | null;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => Promise<{ error?: string }>;
  className: string;
}) {
  const t = useTranslations("sidebar");
  const [pending, startTransition] = useTransition();
  const displayName = name || email || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-11 min-w-0 items-center gap-2.5 rounded-[9px] px-2 text-left transition-colors hover:bg-white/6 data-popup-open:bg-white/8",
          className,
        )}
      >
        <span className="grid size-[30px] flex-none place-items-center rounded-full bg-verde-oliva-dark text-[13px] font-bold text-white">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 max-sm:hidden">
          <span className="block truncate text-[13px] font-semibold text-white">{displayName}</span>
          {name && email && <span className="block truncate text-[11.5px] text-rail-muted">{email}</span>}
        </span>
        <Settings aria-hidden className="ml-auto size-4 flex-none text-rail-muted" strokeWidth={1.8} />
        <span className="sr-only">{t("settings")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={language}
            disabled={pending}
            onValueChange={(lang: AppLanguage) => {
              // Base UI reports a click on the current value too.
              if (lang === language) return;
              startTransition(async () => {
                await onLanguageChange(lang);
              });
            }}
          >
            {APP_LANGUAGES.map((lang) => (
              <DropdownMenuRadioItem key={lang} value={lang} lang={lang}>
                {t(`language.${lang}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SubcontractorsNav({ pathname, counts }: { pathname: string; counts: SubcontractorCounts | null }) {
  const t = useTranslations("sidebar");
  const active = pathname.startsWith(SUBCONTRACTORS_HREF);
  const expiries = counts?.expiries ?? 0;

  return (
    <div className="max-lg:contents">
      <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-rail-muted uppercase lg:block">
        {t("network")}
      </p>
      <Link href={`${SUBCONTRACTORS_HREF}/empresas`} className={navLinkClass(active)} aria-expanded={active}>
        <HardHat
          aria-hidden
          className={cn("size-[19px] flex-none opacity-85", active && "text-rail-accent opacity-100")}
          strokeWidth={1.8}
        />
        {t("subcontractors")}
        {!active && expiries > 0 && (
          <span className="ml-auto rounded-full bg-bad px-1.5 font-mono text-[11px] text-white">
            {expiries}
            <span className="sr-only"> · {t("subcontractorTabs.expiriesCount", { count: expiries })}</span>
          </span>
        )}
      </Link>
      {active && (
        <ul
          className="order-last -mx-3 flex basis-full gap-1 overflow-x-auto px-3 lg:mx-0 lg:mt-0.5 lg:mb-1.5 lg:ml-[21px] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-l lg:border-white/10 lg:px-0"
          aria-label={t("subcontractorTabs.label")}
        >
          {SUBCONTRACTOR_TABS.map((tab) => {
            const current = tab.key !== "expiries" && pathname.startsWith(tab.href);
            const count = counts?.[tab.key];
            return (
              <li key={tab.key} className="flex-none">
                <Link
                  href={tab.href}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] whitespace-nowrap text-rail-muted transition-colors hover:text-rail-foreground lg:-ml-px lg:min-h-9 lg:rounded-none lg:border-l-2 lg:border-transparent lg:px-3.5 lg:text-[13.5px]",
                    current && "bg-white/10 font-semibold text-white lg:border-rail-accent lg:bg-transparent",
                  )}
                  aria-current={current ? "page" : undefined}
                >
                  {t(`subcontractorTabs.${tab.key}`)}
                  {count !== undefined && (tab.key !== "expiries" || count > 0) && (
                    <span
                      className={cn(
                        "ml-auto rounded-full px-1.5 font-mono text-[11px]",
                        tab.key === "expiries" ? "bg-bad text-white" : "bg-white/9 text-rail-foreground",
                      )}
                    >
                      {count}
                      {tab.key === "expiries" && (
                        <span className="sr-only"> · {t("subcontractorTabs.expiriesCount", { count })}</span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PurchasesNav({ pathname, counts }: { pathname: string; counts: PurchasingCounts | null }) {
  const t = useTranslations("sidebar");
  const active = pathname.startsWith(COMPANY_PURCHASES_HREF);
  const due = counts?.dueAttention ?? 0;
  // Pedidos is Compras' own page: current there and on its order pages, not under its siblings.
  const current = (href: string) =>
    href === COMPANY_PURCHASES_HREF
      ? pathname === href || (active && !PURCHASE_TABS.some((tab) => tab.href !== href && pathname.startsWith(tab.href)))
      : pathname.startsWith(href);

  return (
    <div className="max-lg:contents">
      <Link href={COMPANY_PURCHASES_HREF} className={navLinkClass(active)} aria-expanded={active}>
        <ShoppingCart
          aria-hidden
          className={cn("size-[19px] flex-none opacity-85", active && "text-rail-accent opacity-100")}
          strokeWidth={1.8}
        />
        {t("purchases")}
        {due > 0 && (
          <span className="ml-auto rounded-full bg-bad px-1.5 font-mono text-[11px] text-white">
            {due}
            <span className="sr-only"> · {t("purchaseTabs.dueCount", { count: due })}</span>
          </span>
        )}
      </Link>
      {active && (
        <ul
          className="order-last -mx-3 flex basis-full gap-1 overflow-x-auto px-3 lg:mx-0 lg:mt-0.5 lg:mb-1.5 lg:ml-[21px] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-l lg:border-white/10 lg:px-0"
          aria-label={t("purchaseTabs.label")}
        >
          {PURCHASE_TABS.map((tab) => {
            const here = current(tab.href);
            const count = counts?.[tab.key];
            return (
              <li key={tab.key} className="flex-none">
                <Link
                  href={tab.href}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] whitespace-nowrap text-rail-muted transition-colors hover:text-rail-foreground lg:-ml-px lg:min-h-9 lg:rounded-none lg:border-l-2 lg:border-transparent lg:px-3.5 lg:text-[13.5px]",
                    here && "bg-white/10 font-semibold text-white lg:border-rail-accent lg:bg-transparent",
                  )}
                  aria-current={here ? "page" : undefined}
                >
                  {t(`purchaseTabs.${tab.key}`)}
                  {count !== undefined && (
                    <span className="ml-auto rounded-full bg-white/9 px-1.5 font-mono text-[11px] text-rail-foreground">{count}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const subListClass =
  "order-last -mx-3 flex basis-full gap-1 overflow-x-auto px-3 lg:mx-0 lg:mt-0.5 lg:mb-1.5 lg:ml-[21px] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-l lg:border-white/10 lg:px-0";

const subLinkClass = (current: boolean) =>
  cn(
    "flex min-h-11 items-center rounded-full px-3 text-[13px] whitespace-nowrap text-rail-muted transition-colors hover:text-rail-foreground lg:-ml-px lg:min-h-9 lg:rounded-none lg:border-l-2 lg:border-transparent lg:px-3.5 lg:text-[13.5px]",
    current && "bg-white/10 font-semibold text-white lg:border-rail-accent lg:bg-transparent",
  );

/** Proyectos' sections entered before an obra (the doc's Proyectos › Compras), then picked by its filter. */
function ProjectSections({ pathname }: { pathname: string }) {
  const t = useTranslations("sidebar.projectSections");
  return (
    <ul className={subListClass} aria-label={t("label")}>
      {PROJECT_SECTIONS.map((section) => {
        const current = pathname === section.href;
        return (
          <li key={section.key} className="flex-none">
            <Link href={section.href} className={subLinkClass(current)} aria-current={current ? "page" : undefined}>
              {t(section.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectTabs({ projectId, pathname }: { projectId: string; pathname: string }) {
  const t = useTranslations("sidebar.projectTabs");

  return (
    <ul className={subListClass} aria-label={t("label")}>
      {PROJECT_TABS.map((tab) => {
        const href = `/dashboard/projects/${projectId}${tab.path}`;
        // A tab's own pages (e.g. a chapter under Obra) keep it current.
        const active = pathname === href || (tab.path !== "" && pathname.startsWith(`${href}/`));
        return (
          <li key={tab.key} className="flex-none">
            <Link href={href} className={subLinkClass(active)} aria-current={active ? "page" : undefined}>
              {t(tab.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
