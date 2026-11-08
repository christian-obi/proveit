import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: "Prove-It",
  description: "Verifiable private trading track records on NEAR. Screenshots can be faked; Prove-It cards can't.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Prove-It
            </Link>
            <span className="flex gap-4 text-sm text-muted">
              <Link href="/explore" className="hover:text-fg">
                Explore
              </Link>
              <Link href="/verify" className="hover:text-fg">
                Verify
              </Link>
              <Link href="/create" className="hover:text-fg">
                Create a card
              </Link>
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
