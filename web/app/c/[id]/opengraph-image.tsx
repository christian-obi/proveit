import { cardImage, ogSize } from "@/components/CardPageView";
import { NETWORKS } from "@/lib/config";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Prove-It card: verified trading performance";
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  return cardImage((await params).id, NETWORKS.mainnet.registry);
}
