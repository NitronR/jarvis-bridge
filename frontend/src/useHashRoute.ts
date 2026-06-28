import { useCallback, useEffect, useState } from "react";
import type { Route } from "./routes";
import { ROUTES } from "./routes";

export function parseHash(raw: string): Route {
  const h = (raw || "").replace(/^#/, "");
  if (!h) return "chat";
  if ((ROUTES as readonly string[]).includes(h)) return h as Route;
  if (h.startsWith("skill/") && h.length > "skill/".length) return h as Route;
  return "chat";
}

export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? "chat" : parseHash(window.location.hash),
  );
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((r: Route) => {
    const next = r === "chat" ? "" : `#${r}`;
    const cur = window.location.hash;
    const desired = next || "";
    if (cur !== desired) {
      if (next) {
        window.location.hash = next;
      } else {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setRoute(parseHash(next));
    }
  }, []);
  return { route, navigate };
}