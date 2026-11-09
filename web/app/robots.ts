import type { MetadataRoute } from "next";

// Everything public may be crawled, by AI crawlers too.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
