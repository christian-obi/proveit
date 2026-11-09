import type { Metadata } from "next";
import { UnlockPageView } from "@/components/CardPageView";
import { NETWORKS } from "@/lib/config";

type Props = { params: Promise<{ id: string }> };

// Seats and offers change with every sale.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Viewing key for card #${(await params).id} · Prove-It` };
}

export default async function Page({ params }: Props) {
  return <UnlockPageView id={(await params).id} registry={NETWORKS.testnet.registry} />;
}
