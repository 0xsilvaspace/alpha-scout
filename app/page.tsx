"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Banknote,
  Bot,
  Briefcase,
  Cloud,
  Coins,
  GraduationCap,
  Image,
  LayoutGrid,
  AppWindow,
  Radar,
  Siren,
} from "lucide-react";
import {
  ALL_DEALS,
  isActive,
  isExpired,
  isExpiringSoon,
  isOpenToNigeria,
  isWorldwide,
  totalValue,
  TRACK_LABELS,
  type Deal,
  type Track,
} from "@/lib/deals";
import { fetchLiveFeed } from "@/lib/feed";
import StatsBar from "@/components/StatsBar";
import FilterBar, { EMPTY_FILTERS, type Filters } from "@/components/FilterBar";
import DealCard from "@/components/DealCard";

type Tab = "all" | Track | "expiring" | "archive";

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "ai-tools", label: "AI Tools", icon: Bot },
  { id: "crypto", label: "Crypto Airdrops", icon: Coins },
  { id: "nfts", label: "NFTs", icon: Image },
  { id: "scholarships", label: "Scholarships", icon: GraduationCap },
  { id: "jobs", label: "Remote Jobs", icon: Briefcase },
  { id: "banking", label: "U-Cards / Banking", icon: Banknote },
  { id: "cloud", label: "VPS / Cloud", icon: Cloud },
  { id: "software", label: "Software", icon: AppWindow },
  { id: "expiring", label: "Expiry Alert", icon: Siren },
  { id: "archive", label: "Archive", icon: Archive },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [lastSync, setLastSync] = useState("—");
  // Deals start as the baked-in snapshot; the GitHub live feed replaces
  // them in place when it loads. Any feed failure keeps the snapshot.
  const [deals, setDeals] = useState<Deal[]>(ALL_DEALS);
  const [feedSource, setFeedSource] = useState<"live" | "snapshot">(
    "snapshot",
  );

  const formatSync = (d: Date) =>
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  useEffect(() => {
    setLastSync(formatSync(new Date()));
    let cancelled = false;
    fetchLiveFeed().then((feed) => {
      if (cancelled || !feed) return;
      setDeals(feed.deals);
      setFeedSource("live");
      setLastSync(formatSync(new Date(feed.generatedAt)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDeals = useMemo(() => deals.filter(isActive), [deals]);
  const archivedDeals = useMemo(() => deals.filter(isExpired), [deals]);
  const expiringCount = useMemo(
    () => activeDeals.filter(isExpiringSoon).length,
    [activeDeals],
  );
  const trackedValue = useMemo(() => totalValue(activeDeals), [activeDeals]);

  const counts = useMemo(() => {
    const map = new Map<Tab, number>();
    map.set("all", activeDeals.length);
    map.set("expiring", expiringCount);
    map.set("archive", archivedDeals.length);
    (Object.keys(TRACK_LABELS) as Track[]).forEach((t) => {
      map.set(t, activeDeals.filter((d) => d.track === t).length);
    });
    return map;
  }, [activeDeals, archivedDeals, expiringCount]);

  const visible = useMemo(() => {
    let base =
      tab === "all"
        ? activeDeals
        : tab === "expiring"
          ? activeDeals.filter(isExpiringSoon)
          : tab === "archive"
            ? archivedDeals
            : activeDeals.filter((d) => d.track === tab);

    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((d) =>
        [d.title, d.eligibility, d.requirements, d.estimatedValue, d.riskNote]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (filters.nigeria) base = base.filter(isOpenToNigeria);
    if (filters.worldwide) base = base.filter(isWorldwide);
    if (filters.freeNoCard) base = base.filter((d) => d.costType === "truly-free");
    if (filters.expiringSoon) base = base.filter(isExpiringSoon);
    return base;
  }, [tab, search, filters, activeDeals, archivedDeals]);

  const toggleFilter = (key: keyof Filters) =>
    setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="terminal-bg min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-500/50 bg-emerald-500/10">
              <Radar className="h-5 w-5 text-emerald-400" />
            </span>
            <div>
              <h1 className="font-mono text-lg font-bold leading-none tracking-tight text-zinc-50">
                ALPHA<span className="text-emerald-400 glow-text"> SCOUT</span>
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Global Zero-Cost Intelligence Terminal
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5">
            <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-400 glow-emerald" />
            <span className="font-mono text-xs font-semibold text-emerald-300">
              System Status: Online / Auto-Syncing
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        <StatsBar
          activeCount={activeDeals.length}
          totalValue={trackedValue}
          expiringCount={expiringCount}
          archivedCount={archivedDeals.length}
          lastSync={lastSync}
          feedSource={feedSource}
        />

        <nav
          aria-label="Deal categories"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            const count = counts.get(id) ?? 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={active}
                className={
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap " +
                  (active
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 glow-emerald"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-[10px] " +
                    (active ? "bg-emerald-500/25 text-emerald-200" : "bg-zinc-800 text-zinc-400")
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onToggle={toggleFilter}
          resultCount={visible.length}
        />

        {tab === "archive" && archivedDeals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-8 text-center">
            <Archive className="mx-auto h-8 w-8 text-zinc-500" />
            <h2 className="mt-3 font-mono text-sm font-bold text-zinc-200">
              Archive is empty
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
              No deal has expired yet. When a deal passes its expiry date it
              moves here automatically instead of being deleted, so you can
              still see what it offered and when it closed.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-8 text-center">
            <h2 className="font-mono text-sm font-bold text-zinc-200">
              No deals match this view
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
              Try clearing a filter, switching tabs, or searching for a
              different keyword.
            </p>
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </section>
        )}

        <footer className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-center text-xs leading-relaxed text-zinc-500">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
            Disclaimer
          </p>
          <p className="mt-1">
            Always verify eligibility, deadlines and terms on the official
            source before applying — listings change, and some sources are
            roundups, not the official page. No deal on ALPHA SCOUT requires
            payment to participate; never pay an application, deposit or
            “activation” fee for a listing marked free.
          </p>
          <p className="mt-2 font-mono text-[11px]">
            ALPHA SCOUT · 21 deals seeded from the ALPHA SCOUT Space scan of
            11 Nov 2026 · Live deals feed refreshes from GitHub every 4
            hours; if the feed is unreachable the page shows the baked-in
            offline snapshot instead.
          </p>
        </footer>
      </main>
    </div>
  );
}
