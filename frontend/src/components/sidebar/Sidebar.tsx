import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { usePrefs } from "../../hooks/usePrefs";
import { Popover } from "../ui/Popover";
import {
  PONDER_ICONS,
  HomeIcon,
  BookIcon,
  GearIcon,
  PlusIcon,
  CloseIcon,
  CheckIcon,
  TrashIcon,
  GraphIcon,
  AtomIcon,
  CompassIcon,
  SearchIcon,
  CardsIcon,
  NoteIcon,
  SunIcon,
  MoonIcon,
} from "../ui/Icons";

type NavPage = "home" | "canvases" | "review" | "library" | "graph" | "explore" | "settings";

interface Props {
  activeCanvasId: string | null;
  /** Open a canvas; when focusNodeId is given, pan/zoom to that node (global search). */
  onOpenCanvas: (id: string, focusNodeId?: string) => void;
  onNewCanvas: () => void;
  onDeleteCanvas: (id: string) => void;
  onNav: (route: NavPage) => void;
  /** Current top-level page — Home gets the obvious active state (spec §2). */
  activePage?: NavPage;
  /** Mobile: sidebar renders as an overlay when open. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const NAV: { page: NavPage; label: string; Icon: (p: { className?: string; "aria-hidden"?: boolean | "true" }) => JSX.Element }[] = [
  { page: "home", label: "Home", Icon: HomeIcon },
  { page: "canvases", label: "Canvas", Icon: AtomIcon },
  { page: "library", label: "Library", Icon: BookIcon },
  { page: "review", label: "Spaced review", Icon: CardsIcon },
  { page: "graph", label: "Knowledge Graph", Icon: GraphIcon },
  { page: "explore", label: "Explore", Icon: CompassIcon },
  { page: "settings", label: "Settings", Icon: GearIcon },
];

export function Sidebar({
  activeCanvasId,
  onOpenCanvas,
  onNewCanvas,
  onDeleteCanvas,
  onNav,
  activePage = "home",
  mobileOpen = false,
  onMobileClose,
}: Props) {
  const qc = useQueryClient();
  const { icon, setIcon, theme, toggleTheme } = usePrefs();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ---------- global search across all local canvases (roadmap B) ----------
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 200);
    return () => window.clearTimeout(t);
  }, [searchQ]);
  const searching = debouncedQ.length > 0;
  const search = useQuery({
    queryKey: ["search", debouncedQ],
    queryFn: () => api.search(debouncedQ),
    enabled: searching,
  });
  const searchHits = search.data?.results ?? [];

  const canvases = useQuery({ queryKey: ["canvases"], queryFn: api.listCanvases });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 30_000 });

  const activeIcon = PONDER_ICONS.find((i) => i.id === icon) ?? PONDER_ICONS[0]!;

  const del = (id: string) => {
    if (!window.confirm("Delete this canvas and all its nodes?")) return;
    onDeleteCanvas(id);
  };

  const saveRename = () => {
    if (renaming && renameValue.trim()) {
      api.renameCanvas(renaming, renameValue.trim()).then(() => {
        qc.invalidateQueries({ queryKey: ["canvases"] });
        setRenaming(null);
      });
    } else {
      setRenaming(null);
    }
  };

  const nav = (page: NavPage) => {
    onNav(page);
    onMobileClose?.();
  };

  const body = (
    <aside
      className={`w-64 shrink-0 h-full bg-ink-900 border-r border-ink-700 flex-col ${
        mobileOpen ? "fixed inset-y-0 left-0 z-40 shadow-2xl flex" : "hidden lg:flex"
      }`}
      aria-label="Ponder navigation"
    >
      {/* brand */}
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-spark-500/20 bg-spark-500/10"><activeIcon.Icon className="w-5 h-5 ponder-mark shrink-0" aria-hidden="true" /></span>
        <div className="flex-1"><span className="block text-base font-semibold text-fog-100 tracking-tight">Ponder</span><span className="text-[10px] tracking-wide text-fog-500">A little curiosity goes a long way</span></div>
        {mobileOpen && (
          <button className="btn-ghost" title="Close menu" aria-label="Close menu" onClick={onMobileClose}>
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="px-3 pb-4">
        <button className="btn-primary w-full !justify-start !px-3" onClick={() => { onNewCanvas(); onMobileClose?.(); }}><PlusIcon className="h-4 w-4" /> New exploration</button>
      </div>

      {/* primary nav */}
      <nav className="px-3 space-y-1" aria-label="Primary">
        {NAV.map(({ page, label, Icon }) => {
          const active = activePage === page;
          return (
            <button
              key={page}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] transition-colors ${
                active
                  ? "bg-spark-500/10 text-spark-400 font-medium"
                  : "text-fog-300 hover:bg-ink-800 hover:text-fog-100"
              }`}
              onClick={() => nav(page)}
              aria-current={active ? "page" : undefined}
              title={label}
            >
              <Icon className={`w-4 h-4 shrink-0 ${active ? "ponder-mark" : ""}`} aria-hidden="true" />
              <span className="flex-1 text-left">{label}</span>
              {page === "review" && typeof stats.data?.due_count === "number" && stats.data.due_count > 0 && (
                <span
                  className="bg-spark-500/20 text-spark-400 text-xs rounded-full px-1.5 py-0.5"
                  aria-label={`${stats.data.due_count} cards due for review`}
                >
                  {stats.data.due_count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* global search across all local canvases (roadmap B) */}
      <div className="px-3 pt-5">
        <div className="relative">
          <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fog-500" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search all canvases…"
            aria-label="Search all canvases"
            className="w-full rounded-xl bg-ink-850 border border-ink-700 pl-8 pr-7 py-2.5 text-xs text-fog-100 placeholder:text-fog-500 focus:outline-none focus:border-spark-500"
          />
          {searchQ && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fog-500 hover:text-fog-300"
              onClick={() => setSearchQ("")}
              aria-label="Clear search"
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Recent — real explorations only; honest empty state */}
      <div className="flex items-center justify-between px-4 pt-5 pb-1.5">
        <span className="text-xs font-medium text-fog-400">{searching ? `Results for “${debouncedQ}”` : "Recent"}</span>
        <button
          className="btn-ghost !p-1"
          title="New canvas"
          aria-label="New canvas"
          onClick={() => {
            onNewCanvas();
            onMobileClose?.();
          }}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {searching ? (
          search.isPending ? (
            <p className="text-xs text-fog-400 px-2 py-2">Searching…</p>
          ) : search.isError ? (
            <p className="text-xs text-red-400 px-2 py-2">Could not search your workspace. Try again.</p>
          ) : searchHits.length === 0 ? (
            <p className="text-xs text-fog-400 px-2 py-2 leading-relaxed">
              No matches for “{debouncedQ}” in your canvases.
            </p>
          ) : (
            searchHits.map((hit) => (
              <button
                key={`${hit.canvas_id}:${hit.node_id}`}
                className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-ink-800 transition-colors"
                onClick={() => {
                  onOpenCanvas(hit.canvas_id, hit.node_id);
                  setSearchQ("");
                  onMobileClose?.();
                }}
              >
                <span className="block text-[10px] uppercase tracking-wide text-spark-400/80">{hit.canvas_title}</span>
                <span className="block text-xs text-fog-100 truncate mt-0.5">{hit.title || hit.question}</span>
                <span className="block text-[11px] text-fog-400 mt-0.5 line-clamp-2">{hit.snippet}</span>
                <span className="block text-[10px] text-fog-500 mt-0.5">
                  in {hit.field === "term" ? "key term" : hit.field}
                </span>
              </button>
            ))
          )
        ) : canvases.isLoading ? null : (canvases.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-fog-400 px-2 py-2 leading-relaxed">
            Your explorations will appear here once you start.
          </p>
        ) : (
          canvases.data!.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-xl px-3 py-2 cursor-pointer text-xs transition-colors ${
                c.id === activeCanvasId ? "bg-spark-500/10 text-fog-100" : "text-fog-400 hover:bg-ink-800 hover:text-fog-200"
              }`}
              onClick={() => {
                onOpenCanvas(c.id);
                onMobileClose?.();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenCanvas(c.id); onMobileClose?.(); }
              }}
              aria-current={c.id === activeCanvasId ? "page" : undefined}
            >
              {renaming === c.id ? (
                <input
                  autoFocus
                  className="input-bar !py-0.5 !text-xs flex-1"
                  aria-label="Canvas name"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => e.key === "Enter" && saveRename()}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="flex-1 truncate">{c.title}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 btn-ghost !p-1"
                    title="Rename canvas"
                    aria-label={`Rename canvas ${c.title}`}
                    onClick={(event) => { event.stopPropagation(); setRenameValue(c.title); setRenaming(c.id); }}
                  >
                    <NoteIcon className="w-3 h-3" />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 btn-ghost !p-1"
                    title="Delete canvas"
                    aria-label={`Delete canvas ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      del(c.id);
                    }}
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* footer card — becomes a real Review entry point when cards are due (real data only) */}
      <div className="p-3 pt-0">
        {(stats.data?.due_count ?? 0) > 0 ? (
          <button
            className="w-full text-left rounded-xl border border-spark-500/40 bg-spark-500/10 px-3.5 py-3 transition-colors hover:bg-spark-500/15"
            onClick={() => nav("review")}
            title="Open spaced review"
          >
            <p className="text-[13px] font-medium text-fog-100 leading-snug">
              {stats.data!.due_count} idea{stats.data!.due_count === 1 ? "" : "s"} ready for review
            </p>
            <p className="text-[11px] text-spark-400 mt-1">Review now →</p>
          </button>
        ) : (
          <div className="rounded-xl border border-ink-700 bg-ink-850/70 px-3.5 py-3">
            <p className="text-[13px] font-medium text-fog-200 leading-snug">Better questions. Deeper understanding.</p>
            <p className="text-[11px] text-fog-400 mt-1">Explore · Learn · Create</p>
          </div>
        )}
      </div>

      {/* workspace icon picker — persisted identity (kept from previous design) */}
      <div className="px-3 pb-4 pt-3 border-t border-ink-700 flex items-center justify-between relative">
        <Popover
          align="left"
          trigger={({ onClick, ref, ...aria }) => (
            <button ref={ref} onClick={onClick} {...aria} className="btn-ghost flex items-center gap-1.5 text-xs" title="Choose your Ponder icon">
              <activeIcon.Icon className="w-4 h-4 ponder-mark" aria-hidden="true" />
              <span className="text-fog-400">Icon</span>
            </button>
          )}
          title="Ponder icon"
          hint="Shown as your workspace mark, remembered on this device."
        >
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Ponder icon options">
            {PONDER_ICONS.map(({ id, label, Icon }) => {
              const selected = id === icon;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={selected}
                  title={label}
                  aria-label={`${label}${selected ? " (selected)" : ""}`}
                  onClick={() => setIcon(id)}
                  className={`relative flex items-center justify-center rounded-lg p-2.5 transition-colors ${
                    selected
                      ? "bg-spark-500/20 text-spark-400 border border-spark-500"
                      : "text-fog-300 hover:bg-ink-700 hover:text-fog-100 border border-transparent"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {selected && (
                    <span className="absolute -top-1 -right-1 bg-spark-500 text-white rounded-full p-0.5">
                      <CheckIcon className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Popover>
        <button className="btn-ghost flex items-center gap-1.5 text-xs" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">{theme === "dark" ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}<span className="text-fog-400">{theme === "dark" ? "Light" : "Dark"}</span></button>
      </div>
    </aside>
  );

  if (!mobileOpen) return body;

  // Mobile overlay: dimmed backdrop closes on click, sidebar slides over content.
  return (
    <div className="lg:hidden fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} aria-hidden="true" />
      {body}
    </div>
  );
}
