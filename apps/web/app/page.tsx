import { useTranslations } from "next-intl";
import { LoginForm } from "./components/LoginForm";

export default function LoginPage() {
  const t = useTranslations("login");
  const year = new Date().getFullYear();

  return (
    <main className="dark relative flex min-h-svh flex-col items-center justify-center bg-grafito px-6 py-10 text-blanco-calido">
      <div className="flex flex-col items-center text-center">
        <h1 className="font-sans text-[40px] leading-none font-light tracking-[0.15em] sm:text-[56px]">ViTAH</h1>
        <p className="mt-3 text-[10px] tracking-[0.25em] text-verde-oliva-light uppercase sm:text-[11px]">{t("descriptor")}</p>
      </div>

      <LoginForm />

      <footer className="absolute inset-x-0 bottom-6 text-center text-xs text-muted-foreground">
        <p>{t("footer", { year })}</p>
      </footer>
    </main>
  );
}
