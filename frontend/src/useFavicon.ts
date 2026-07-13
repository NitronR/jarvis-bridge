import { useEffect } from "react";
import { useChatContext } from "./state/ChatContext";

const COLORS: Record<string, string> = {
  idle: "#3B82F6",
  busy: "#F97316",
  unread: "#22C55E",
};

function makeDataUri(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${color}"/></svg>`,
  )}`;
}

export function useFavicon(): void {
  const { state } = useChatContext();

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }

    let color: string;
    if (state.busy) color = COLORS.busy;
    else if (state.unread) color = COLORS.unread;
    else color = COLORS.idle;

    link.href = makeDataUri(color);
  }, [state.busy, state.unread]);
}
