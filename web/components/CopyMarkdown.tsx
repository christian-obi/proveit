"use client";

// Copies the current docs page as Markdown, for pasting into an AI assistant.

import { useState } from "react";

export default function CopyMarkdown({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1_500);
  };
  return (
    <button onClick={copy} className="chip">
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : "Copy page"}
    </button>
  );
}
