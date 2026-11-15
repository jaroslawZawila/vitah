import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Barlow_Condensed, Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ClientMessages from "@/i18n/ClientMessages";
import { cn } from "@/lib/utils";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  preload: false,
});

export const metadata: Metadata = {
  title: "ViTAH — Tecnología para vivir mejor",
  description:
    "Plataforma PropTech de bienestar habitable. Viviendas saludables, eficientes e inteligentes.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={cn(figtree.variable, barlowCondensed.variable, jetbrainsMono.variable)}
    >
      <body>
        {/* Only the signed-out pages' text: each layout below adds what its pages use. */}
        <ClientMessages scope="">{children}</ClientMessages>
        <SpeedInsights />
      </body>
    </html>
  );
}
