"use client";

// The docs sidebar: the pages from SUMMARY.md, grouped, with an instant title filter.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavPage = { title: string; href: string; group: string };

export default function DocsNav({ pages }: { pages: NavPage[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const visible = pages.filter((p) => p.title.toLowerCase().includes(needle));
  const groups = [...new Set(visible.map((p) => p.group))];

  return (
    <nav aria-label="Documentation" className="space-y-5 text-sm">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pages…" aria-label="Filter pages" className="w-full border border-line bg-panel px-2 py-1.5 font-mono text-xs" />
      {groups.map((g) => (
        <div key={g || "intro"}>
          {g && <p className="label mb-2">{g}</p>}
          <ul className="space-y-0.5">
            {visible
              .filter((p) => p.group === g)
              .map((p) => (
                <li key={p.href}>
                  <Link href={p.href} aria-current={p.href === path ? "page" : undefined} className={`doc-link ${p.href === path ? "is-on" : ""}`}>
                    {p.title}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {visible.length === 0 && <p className="text-xs text-muted">No matching pages.</p>}
    </nav>
  );
}
