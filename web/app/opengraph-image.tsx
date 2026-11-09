import { siteImage } from "@/components/ShareCard";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Prove-It: verifiable private trading records on NEAR";
export const dynamic = "force-dynamic";

export default function Image() {
  return siteImage();
}
