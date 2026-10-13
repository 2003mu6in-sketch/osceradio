import { useEffect, useState } from "react";
import { loadContent } from "./content.ts";
import type { Content } from "./types.ts";

export function useContent(): { content: Content | null; error: string | null } {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadContent().then((c) => live && setContent(c), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, []);
  return { content, error };
}
