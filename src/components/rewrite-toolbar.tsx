"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RewriteToolbarProps {
  position: { top: number; left: number } | null;
  selectedText: string;
  fullContext: string;
  onRewrite: (rewritten: string) => void;
  onDismiss: () => void;
}

export function RewriteToolbar({
  position,
  selectedText,
  fullContext,
  onRewrite,
  onDismiss,
}: RewriteToolbarProps) {
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (position) {
      setInstruction("");
    }
  }, [position]);

  useEffect(() => {
    if (!position) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Don't dismiss when clicking inside the editor (textarea, code mirror, etc)
      const editorEl = (target as Element).closest?.("[data-color-mode]");
      if (editorEl) return;
      onDismiss();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [position, onDismiss]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!instruction.trim() || loading) return;

      setLoading(true);
      try {
        const res = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedText,
            instruction: instruction.trim(),
            fullContext,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error || `Rewrite failed: ${res.status}`
          );
        }

        const { rewritten } = await res.json();
        onRewrite(rewritten);
        toast.success("Text rewritten");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Rewrite failed"
        );
      } finally {
        setLoading(false);
      }
    },
    [instruction, loading, selectedText, fullContext, onRewrite]
  );

  if (!position) return null;

  return (
    <div
      ref={containerRef}
      className="absolute z-50 flex items-center gap-1.5 rounded-lg border bg-popover p-1.5 shadow-md"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateY(8px)",
      }}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Reframe as…"
          className="h-7 w-56 text-xs"
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="submit"
          size="xs"
          disabled={!instruction.trim() || loading}
        >
          {loading ? "Rewriting…" : "Rewrite"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          &times;
        </Button>
      </form>
    </div>
  );
}
