import type { Metadata } from "next";
import CreateFlow from "@/components/CreateFlow";

export const metadata: Metadata = { title: "Create a card · Prove-It" };

export default function CreatePage() {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create a card</h1>
        <p className="text-muted">
          Your Hyperliquid wallet signs one message that proves you control the account. It can&apos;t move funds or place
          trades. The message is encrypted in this browser so only the enclave can read it, and the card never shows your
          address.
        </p>
      </div>
      <CreateFlow />
    </section>
  );
}
