"use client";

import { useEffect, useState } from "react";

interface ScreenshotPreviewProps {
  src: Blob | string;
}

export function ScreenshotPreview({ src }: ScreenshotPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof src === "string") {
      setUrl(src);
      return;
    }
    const objectUrl = URL.createObjectURL(src);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [src]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt="Screenshot preview"
      className="h-20 w-32 rounded border object-cover"
    />
  );
}
