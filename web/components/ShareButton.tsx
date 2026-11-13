"use client";

// Share a card: post it on X or Telegram, copy the link or the post text, save the picture,
// or hand it to the phone's own share sheet. The link unfurls into the card's preview image.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shareTargets, shareText, type ShareStats } from "@/lib/share";

export default function ShareButton({ path, stats, days, demo }: { path: string; stats: ShareStats; days: number; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [canNative, setCanNative] = useState(false);
  // The menu is rendered on <body> and fixed to the viewport: cards clip and shake their contents.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const url = () => `${window.location.origin}${path}`;
  const text = shareText(stats, days, demo);
  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 1_500);
  };
  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
      flash(done);
    } catch {
      flash("Copy failed");
    }
    setOpen(false);
  };
  const native = async () => {
    setOpen(false);
    try {
      await navigator.share({ title: "Prove-It card", text, url: url() });
    } catch {
      // The person closed the share sheet.
    }
  };

  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) {
      // Open downwards, or upwards when there is no room below.
      const menuHeight = 240;
      const top = r.bottom + 4 + menuHeight > window.innerHeight ? Math.max(8, r.top - 4 - menuHeight) : r.bottom + 4;
      setAt({ top, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((o) => !o);
  };

  const item = "block w-full px-3 py-2 text-left hover:bg-line hover:text-accent";
  return (
    <div ref={box} className="relative inline-block" data-share>
      <button type="button" className={`chip ${open ? "is-on" : ""}`} aria-haspopup="menu" aria-expanded={open} ref={button} onClick={toggle}>
        {note ?? "Share"}
      </button>
      {open && at && createPortal(
        <div ref={menu} role="menu" style={{ top: at.top, right: at.right }} className="share-menu fixed z-50 w-52 border border-line bg-panel py-1 font-mono text-xs shadow-lg">
          <a role="menuitem" className={item} href={shareTargets(text, url()).x} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            Post on X
          </a>
          <a role="menuitem" className={item} href={shareTargets(text, url()).telegram} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            Share on Telegram
          </a>
          <button role="menuitem" type="button" className={item} onClick={() => copy(url(), "Link copied")}>
            Copy link
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => copy(`${text} ${url()}`, "Post copied")}>
            Copy post text
          </button>
          <a role="menuitem" className={item} href={shareTargets(text, url()).image} download={`prove-it-card${path.replaceAll("/", "-")}.png`} onClick={() => setOpen(false)}>
            Save image
          </a>
          {canNative && (
            <button role="menuitem" type="button" className={item} onClick={native}>
              More…
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
