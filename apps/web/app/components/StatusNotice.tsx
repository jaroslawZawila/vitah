import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Presentational: what a page says when it can't show what was asked for (an
 * error, "No encontrado", "No tienes permiso"): a label, the title, a line of
 * explanation, what to do next (`children`: buttons and links) and, for an
 * error, the code to quote to support.
 *
 * In the workspace it is a card in the flow (the rail stays beside it);
 * `page` puts it alone on a grafito page, like the login.
 */
export default function StatusNotice({
  eyebrow,
  title,
  text,
  digest,
  tone = "muted",
  page = false,
  descriptor,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  /** An error's digest, with its label: the same id is in the server's log line. */
  digest?: { label: string; value: string };
  tone?: "muted" | "bad";
  page?: boolean;
  /** The wordmark's descriptor ("TECNOLOGÍA PARA VIVIR MEJOR"), on a `page`. */
  descriptor?: string;
  children?: React.ReactNode;
}) {
  const notice = (
    <>
      <p className={cn("eyebrow", tone === "bad" && "text-destructive")}>{eyebrow}</p>
      <h1>{title}</h1>
      <p className="max-w-[52ch] text-[14.5px] text-pretty text-muted-foreground">{text}</p>
      {children && <div className={cn("mt-2 flex flex-wrap gap-2", page && "justify-center")}>{children}</div>}
      {digest && (
        <p className="mt-2 text-meta text-muted-foreground">
          {digest.label}: <code className="num text-foreground select-all">{digest.value}</code>
        </p>
      )}
    </>
  );

  if (!page) {
    return <section className={cn(cardVariants(), "items-start gap-3 py-8 sm:px-8 sm:py-10")}>{notice}</section>;
  }
  return (
    <main className="dark flex min-h-svh flex-col items-center justify-center gap-10 bg-grafito px-4 py-10 text-blanco-calido">
      <div className="flex flex-col items-center text-center">
        <p className="font-sans text-[32px] leading-none font-light tracking-[0.15em] sm:text-[40px]">ViTAH</p>
        {descriptor && <p className="mt-3 text-xs tracking-[0.25em] text-verde-oliva-light uppercase">{descriptor}</p>}
      </div>
      <section className="flex w-full max-w-[480px] flex-col items-center gap-3 text-center">{notice}</section>
    </main>
  );
}
