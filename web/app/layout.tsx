import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import FxToggle from "@/components/FxToggle";
import NetworkSwitch from "@/components/NetworkSwitch";
import WalletButton from "@/components/WalletButton";
import { config } from "@/lib/config";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: "Prove-It",
  description: "Verifiable private trading track records on NEAR. Screenshots can be faked; Prove-It cards can't.",
  openGraph: { title: "Prove-It", description: "Verifiable private trading track records on NEAR. Screenshots can be faked; Prove-It cards can't.", siteName: "Prove-It" },
  twitter: { card: "summary_large_image" },
};

// Runs before first paint so a saved motion level never flashes.
const FX_SCRIPT = `try{var f=localStorage.getItem('fx');if(f==='full'||f==='lite'||f==='off')document.documentElement.dataset.fx=f}catch(e){}`;

const LINKS = [
  ["/explore", "Explore"],
  ["/docs", "Docs"],
  ["/verify", "Verify"],
  ["/create", "Create a card"],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-fx="full" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Script id="fx-level" strategy="beforeInteractive">
          {FX_SCRIPT}
        </Script>
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
            <Link href="/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" width={24} height={24} />
              Prove-It
            </Link>
            <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {LINKS.map(([href, label]) => (
                <Link key={href} href={href} className="nav-link">
                  {label}
                </Link>
              ))}
              <NetworkSwitch />
              <WalletButton />
            </span>
          </nav>
        </header>
        <main className="page-main px-4 py-8 sm:px-8">{children}</main>
        <FxToggle />
      </body>
    </html>
  );
}
