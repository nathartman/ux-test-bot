"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RewriteToolbar } from "./rewrite-toolbar";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
});

interface NotesEditorProps {
  value: string;
  onChange: (value: string) => void;
}

interface SelectionState {
  text: string;
  start: number;
  end: number;
  position: { top: number; left: number };
}

export function NotesEditor({ value, onChange }: NotesEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Markdown copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }, [value]);

  const handleMouseUp = useCallback(() => {
    // Delay to let the browser finalize the selection before we read it
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const textarea = container.querySelector("textarea");
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      if (selectionStart === selectionEnd) {
        setSelection(null);
        return;
      }

      const selectedText = value.substring(selectionStart, selectionEnd);
      if (!selectedText.trim()) {
        setSelection(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();

      // Position the toolbar based on textarea geometry since DOM selection
      // on a textarea doesn't give us a useful bounding rect
      const textareaRect = textarea.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      const textBeforeSelection = value.substring(0, selectionStart);
      const linesAbove = textBeforeSelection.split("\n").length;
      const topOffset =
        textareaRect.top -
        containerRect.top +
        linesAbove * lineHeight -
        textarea.scrollTop;

      setSelection({
        text: selectedText,
        start: selectionStart,
        end: selectionEnd,
        position: {
          top: Math.min(topOffset + lineHeight, containerRect.height - 50),
          left: 16,
        },
      });
    });
  }, [value]);

  const handleRewrite = useCallback(
    (rewritten: string) => {
      if (!selection) return;

      const before = value.substring(0, selection.start);
      const after = value.substring(selection.end);
      onChange(before + rewritten + after);
      setSelection(null);
    },
    [selection, value, onChange]
  );

  const handleDismiss = useCallback(() => {
    setSelection(null);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">Session Notes</h2>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          Copy markdown
        </Button>
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        data-color-mode="light"
        onMouseUp={handleMouseUp}
      >
        <MDEditor
          value={value}
          onChange={(val) => onChange(val ?? "")}
          height="100%"
          preview="live"
          visibleDragbar={false}
        />
        <RewriteToolbar
          position={selection?.position ?? null}
          selectedText={selection?.text ?? ""}
          fullContext={value}
          onRewrite={handleRewrite}
          onDismiss={handleDismiss}
        />
      </div>
    </div>
  );
}
