import type { Metadata } from "next";
import { CardPageView, cardMetadata } from "@/components/CardPageView";
import { NETWORKS } from "@/lib/config";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ verify?: string }> };

// Cards change only when refreshed or revoked; re-read the registry every minute.
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return cardMetadata((await params).id, NETWORKS.testnet.registry);
}

export default async function Page({ params, searchParams }: Props) {
  return <CardPageView id={(await params).id} registry={NETWORKS.testnet.registry} autoRun={(await searchParams).verify === "1"} />;
}
