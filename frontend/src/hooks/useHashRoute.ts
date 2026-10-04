import { useEffect, useState } from "react";

/**
 * Hash routes: #/canvas/:id · #/review · #/library · #/graph · #/settings · #/ (home).
 * Hash routing keeps deep links working from any static host without rewrites.
 */
export type Route =
  | { page: "canvas"; canvasId: string }
  | { page: "home" | "review" | "library" | "graph" | "explore" | "settings" };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("canvas/")) {
    const id = h.slice("canvas/".length);
    if (id) return { page: "canvas", canvasId: id };
  }
  if (h === "review") return { page: "review" };
  if (h === "library") return { page: "library" };
  if (h === "graph") return { page: "graph" };
  if (h === "explore") return { page: "explore" };
  if (h === "settings") return { page: "settings" };
  return { page: "home" };
}

export function routeToHash(route: Route): string {
  if (route.page === "canvas") return `#/canvas/${route.canvasId}`;
  return `#/${route.page === "home" ? "" : route.page}`;
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (r: Route) => {
    const target = routeToHash(r);
    if (window.location.hash !== target) {
      window.location.hash = target; // triggers hashchange → setRoute
    } else {
      setRoute(r);
    }
  };

  return [route, navigate];
}
