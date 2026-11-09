import type { Metadata } from "next";
import { FeedPageView } from "@/components/CardPageView";
import { NETWORKS } from "@/lib/config";

type Props = { params: Promise<{ id: string }> };

// Seats and offers change with every sale.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Live feed for card #${(await params).id} · Prove-It` };
}

export default async function Page({ params }: Props) {
  return <FeedPageView id={(await params).id} registry={NETWORKS.testnet.registry} />;
}
