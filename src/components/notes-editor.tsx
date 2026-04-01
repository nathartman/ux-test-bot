"use client";

import { useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Button } from "@/components/ui/button";

interface NotesEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function NotesEditor({ value, onChange }: NotesEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const suppressUpdateRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        markedOptions: { gfm: true },
      }),
      TableKit.configure({}),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (suppressUpdateRef.current) return;
      const md = editor.getMarkdown();
      onChangeRef.current(md);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm prose-tight mx-auto max-w-3xl px-6 py-4 outline-none min-h-full",
        spellcheck: "false",
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = editor.getMarkdown();
    if (value !== currentMd) {
      suppressUpdateRef.current = true;
      editor.commands.setContent(value, { contentType: "markdown" });
      suppressUpdateRef.current = false;
    }
  }, [value, editor]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Markdown copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }, [value]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">Session Notes</h2>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          Copy markdown
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
