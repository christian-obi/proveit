import Link from "next/link";

// Placeholder landing page; P6 replaces it with the fake-screenshot-vs-real-card demo.
export default function Home() {
  return (
    <section className="space-y-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Screenshots can be faked. Prove-It cards can&apos;t.</h1>
      <p className="max-w-xl text-muted">
        Prove your Hyperliquid performance without revealing your wallet. A TEE computes your stats and signs a card, and
        anyone can verify it on NEAR.
      </p>
      <Link href="/create" className="inline-block rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
        Create a card
      </Link>
    </section>
  );
}
