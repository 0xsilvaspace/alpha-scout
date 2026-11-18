"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AppWindow,
  Archive,
  ArrowRight,
  Banknote,
  Bot,
  Briefcase,
  CalendarClock,
  Cloud,
  Coins,
  Globe,
  GraduationCap,
  HandCoins,
  LayoutGrid,
  Medal,
  Trophy,
} from "lucide-react";
import {
  ALL_DEALS,
  isActive,
  isExpiringSoon,
  isOpenToNigeria,
  isWorldwide,
  type Deal,
} from "@/lib/deals";
import {
  COMPETITION_KIND_LABELS,
  DISPLAY_LABELS,
  GRANT_KIND_LABELS,
  HACKATHON_KIND_LABELS,
  prepareDeals,
  type CompetitionKind,
  type DisplayTrack,
  type GrantKind,
  type HackathonKind,
  type ResolvedDeal,
} from "@/lib/classify";
import { fetchLiveFeed } from "@/lib/feed";
import { getBrowserSupabase } from "@/lib/supabase/client";
import AuthPanel from "@/components/AuthPanel";
import Chatbot from "@/components/Chatbot";
import StatsBar from "@/components/StatsBar";
import FilterBar, { EMPTY_FILTERS, type Filters } from "@/components/FilterBar";
import DealCard from "@/components/DealCard";

// The 3D globe renders only in the browser, after the page loads.
const Hero3D = dynamic(() => import("@/components/Hero3D"), { ssr: false });

type Tab = "all" | DisplayTrack | "expiring" | "archive";
type GrantFilter = "all" | GrantKind;
type HackathonFilter = "all" | HackathonKind;
type CompetitionFilter = "all" | CompetitionKind;

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "scholarships", label: "Scholarships", icon: GraduationCap },
  { id: "grants", label: "Grants", icon: HandCoins },
  { id: "internships", label: "International Internships", icon: Globe },
  { id: "ai-tools", label: "AI Tools", icon: Bot },
  { id: "hackathons", label: "Hackathons", icon: Trophy },
  { id: "competitions", label: "Competitions", icon: Medal },
  { id: "jobs", label: "Remote Jobs", icon: Briefcase },
  { id: "cloud", label: "Cloud", icon: Cloud },
  { id: "software", label: "Software", icon: AppWindow },
  { id: "banking", label: "Banking", icon: Banknote },
  { id: "crypto", label: "Crypto", icon: Coins },
  { id: "expiring", label: "Expiring soon", icon: CalendarClock },
  { id: "archive", label: "Archive", icon: Archive },
];

/** Subsection pills for one tab. Labels come from classify.ts, so the
 * filter names and the card badges can never drift apart. */
const GRANT_FILTERS: { id: GrantFilter; label: string }[] = [
  { id: "all", label: "All Grants" },
  ...(Object.keys(GRANT_KIND_LABELS) as GrantKind[]).map((kind) => ({
    id: kind as GrantFilter,
    label: GRANT_KIND_LABELS[kind],
  })),
];

const HACKATHON_FILTERS: { id: HackathonFilter; label: string }[] = [
  { id: "all", label: "All Hackathons" },
  ...(Object.keys(HACKATHON_KIND_LABELS) as HackathonKind[]).map((kind) => ({
    id: kind as HackathonFilter,
    label: HACKATHON_KIND_LABELS[kind],
  })),
];

const COMPETITION_FILTERS: { id: CompetitionFilter; label: string }[] = [
  { id: "all", label: "All Competitions" },
  ...(Object.keys(COMPETITION_KIND_LABELS) as CompetitionKind[]).map(
    (kind) => ({
      id: kind as CompetitionFilter,
      label: COMPETITION_KIND_LABELS[kind],
    }),
  ),
];

/** Subsection pills for one tab (grants, hackathons, competitions).
 * Only kinds with at least one live deal are shown, so an empty kind
 * never appears as a dead pill. */
function SubFilters<T extends string>({
  filters,
  counts,
  active,
  onSelect,
  label,
}: {
  filters: { id: T; label: string }[];
  counts: Record<T, number>;
  active: T;
  onSelect: (id: T) => void;
  label: string;
}) {
  return (
    <div
      className="mt-2 flex flex-wrap gap-2"
      role="group"
      aria-label={label}
    >
      {filters
        .filter((f) => (counts[f.id] ?? 0) > 0)
        .map(({ id, label: filterLabel }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(id)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium " +
                (isActive
                  ? "border-green-800 bg-green-800 text-white"
                  : "border-stone-300 bg-white text-stone-600 hover:border-stone-400")
              }
            >
              {filterLabel}
              <span className="text-[11px] opacity-70">{counts[id]}</span>
            </button>
          );
        })}
    </div>
  );
}

const HOW_IT_WORKS: { title: string; text: string }[] = [
  {
    title: "1. Sourced",
    text: "We scan official sources for free scholarships, grants, international internships, hackathons, competitions, jobs and tools that are open to Nigeria.",
  },
  {
    title: "2. Checked",
    text: "Each listing is checked for eligibility, cost and deadline before it appears here. Nothing on this page requires payment.",
  },
  {
    title: "3. Updated",
    text: "The list refreshes every 24 hours. Save an opportunity to your archive if you want to keep it for later.",
  },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("all");
  const [grantFilter, setGrantFilter] = useState<GrantFilter>("all");
  const [hackathonFilter, setHackathonFilter] =
    useState<HackathonFilter>("all");
  const [competitionFilter, setCompetitionFilter] =
    useState<CompetitionFilter>("all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [lastSync, setLastSync] = useState("");
  // Deals start as the baked-in snapshot; the GitHub live feed replaces
  // them in place when it loads. Any feed failure keeps the snapshot.
  const [deals, setDeals] = useState<Deal[]>(ALL_DEALS);
  const [feedSource, setFeedSource] = useState<"live" | "snapshot">(
    "snapshot",
  );

  // Saved opportunities (the Archive): kept in localStorage on this
  // device only, so they survive reloads. No account, no server.
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("alpha-scout-saved");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedIds(
            parsed.filter((n): n is number => typeof n === "number"),
          );
        }
      }
    } catch {
      // Corrupt storage: start with an empty archive.
    }
    setSavedLoaded(true);
  }, []);
  useEffect(() => {
    if (!savedLoaded) return;
    try {
      window.localStorage.setItem(
        "alpha-scout-saved",
        JSON.stringify(savedIds),
      );
    } catch {
      // Storage full or unavailable: keep the in-memory list.
    }
  }, [savedIds, savedLoaded]);

  // Snapshots of saved deals: the feed is the only copy of a deal's
  // details, and expired deals are deleted from the feed, so a saved
  // deal's snapshot is taken when it is saved. That is what keeps an
  // expired saved deal visible in the Archive after it leaves the
  // board; unsaved deals are simply gone. Snapshots are kept in
  // localStorage on this device and mirrored to the cloud archive
  // (saved_items.snapshot) when signed in, so they follow the user.
  const [savedSnapshots, setSavedSnapshots] = useState<
    Record<number, ResolvedDeal>
  >({});
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("alpha-scout-snapshots");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const snaps: Record<number, ResolvedDeal> = {};
          for (const [k, v] of Object.entries(
            parsed as Record<string, unknown>,
          )) {
            const id = Number(k);
            if (Number.isFinite(id) && v && typeof v === "object") {
              snaps[id] = v as ResolvedDeal;
            }
          }
          setSavedSnapshots(snaps);
        }
      }
    } catch {
      // Corrupt storage: start with no snapshots.
    }
    setSnapshotsLoaded(true);
  }, []);
  useEffect(() => {
    if (!snapshotsLoaded) return;
    try {
      window.localStorage.setItem(
        "alpha-scout-snapshots",
        JSON.stringify(savedSnapshots),
      );
    } catch {
      // Storage full or unavailable: keep the in-memory map.
    }
  }, [savedSnapshots, snapshotsLoaded]);

  const toggleSave = (deal: ResolvedDeal) => {
    const id = deal.id;
    const removing = savedIds.includes(id);
    setSavedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    // Keep (or drop) this deal's snapshot, so an expired saved deal
    // stays in the Archive after it leaves the feed.
    setSavedSnapshots((prev) => {
      if (removing) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: deal };
    });
    // Signed in: mirror the change to the cloud archive as well.
    const supabase = getBrowserSupabase();
    if (supabase && userId) {
      if (removing) {
        void supabase
          .from("saved_items")
          .delete()
          .eq("user_id", userId)
          .eq("deal_id", String(id));
      } else {
        void supabase
          .from("saved_items")
          .upsert(
            { user_id: userId, deal_id: String(id), snapshot: deal },
            { onConflict: "user_id,deal_id" },
          );
      }
    }
  };

  // Account: email + password sign up with a 6-digit email code, and
  // sign in. Signed-in users get their archive synced and the chatbot.
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUserEmail(u?.email ?? null);
      setUserId(u?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const u = session?.user ?? null;
        setUserEmail(u?.email ?? null);
        setUserId(u?.id ?? null);
        if (!u) setCloudReady(false);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // On sign-in, merge the cloud archive with this device's saved list:
  // anything saved here that is not in the cloud gets uploaded.
  useEffect(() => {
    if (!userEmail || !userId || !savedLoaded || cloudReady) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("saved_items")
        .select("deal_id, snapshot");
      if (cancelled) return;
      if (error) {
        // Cloud read failed: keep the local list only.
        setCloudReady(true);
        return;
      }
      const cloudIds = (data ?? [])
        .map((r) => Number(r.deal_id))
        .filter((n) => Number.isFinite(n));
      const cloudHasSnap = new Set(
        (data ?? [])
          .filter((r) => r.snapshot && typeof r.snapshot === "object")
          .map((r) => Number(r.deal_id))
          .filter((n) => Number.isFinite(n)),
      );
      const merged = Array.from(new Set([...savedIds, ...cloudIds]));
      // Snapshots: the cloud's copy first, then this device's, then
      // the live feed (freshest) for anything still listed. This also
      // backfills snapshots for deals saved before snapshots existed.
      const snaps: Record<number, ResolvedDeal> = {};
      (data ?? []).forEach((r) => {
        const id = Number(r.deal_id);
        if (Number.isFinite(id) && r.snapshot && typeof r.snapshot === "object") {
          snaps[id] = r.snapshot as ResolvedDeal;
        }
      });
      Object.entries(savedSnapshots).forEach(([k, d]) => {
        snaps[Number(k)] = d;
      });
      prepared.forEach((d) => {
        if (merged.includes(d.id)) snaps[d.id] = d;
      });
      setSavedSnapshots(snaps);
      // Upload anything the cloud is missing: ids it never saw, and
      // rows saved before snapshots existed.
      const missing = merged.filter(
        (id) => !cloudIds.includes(id) || !cloudHasSnap.has(id),
      );
      if (missing.length > 0) {
        await supabase.from("saved_items").upsert(
          missing.map((id) => ({
            user_id: userId,
            deal_id: String(id),
            snapshot: snaps[id] ?? null,
          })),
          { onConflict: "user_id,deal_id" },
        );
      }
      if (!cancelled) {
        setSavedIds(merged);
        setCloudReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per sign-in; savedIds is the local list at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, userId, savedLoaded, cloudReady]);

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

  // One load path for both sources: dedupe, then re-classify into the
  // display tracks (Grants, Hackathons, Crypto last). Each opportunity
  // appears exactly once, in exactly one tab.
  const prepared: ResolvedDeal[] = useMemo(() => prepareDeals(deals), [deals]);

  const activeDeals = useMemo(() => prepared.filter(isActive), [prepared]);
  // The Archive is the user's saved list, not expired deals. Expired
  // deals simply leave the active list; saved ones stay here even after
  // their closing date passes.
  const savedDeals = useMemo(
    () => prepared.filter((d) => savedIds.includes(d.id)),
    [prepared, savedIds],
  );
  // Saved deals that have left the feed (their deadline passed and
  // they were deleted from the board) live on in the Archive from
  // their snapshots. Unsaved deals are gone entirely, and deleted
  // deals count nowhere in the active numbers: they are not in
  // `prepared`, so activeDeals and every tab count exclude them.
  const archivedDeals = useMemo(() => {
    const inFeed = new Set(prepared.map((d) => d.id));
    return savedIds
      .filter((id) => !inFeed.has(id))
      .map((id) => savedSnapshots[id])
      .filter((d): d is ResolvedDeal => !!d)
      .sort((a, b) => ((a.expiresOn ?? "") < (b.expiresOn ?? "") ? 1 : -1));
  }, [prepared, savedIds, savedSnapshots]);
  // The archived section only shows on the Archive tab, and honours
  // the search text like the main list.
  const archivedVisible = useMemo(() => {
    if (tab !== "archive") return [];
    const q = search.trim().toLowerCase();
    if (!q) return archivedDeals;
    return archivedDeals.filter((d) =>
      [d.title, d.eligibility, d.requirements, d.estimatedValue, d.riskNote, d.funder]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [tab, search, archivedDeals]);
  const expiringCount = useMemo(
    () => activeDeals.filter(isExpiringSoon).length,
    [activeDeals],
  );
  const verifiedCount = useMemo(
    () => activeDeals.filter((d) => d.verification === "verified").length,
    [activeDeals],
  );

  const counts = useMemo(() => {
    const map = new Map<Tab, number>();
    map.set("all", activeDeals.length);
    map.set("expiring", expiringCount);
    map.set("archive", savedDeals.length + archivedDeals.length);
    (Object.keys(DISPLAY_LABELS) as DisplayTrack[]).forEach((t) => {
      map.set(t, activeDeals.filter((d) => d.track === t).length);
    });
    return map;
  }, [activeDeals, savedDeals, archivedDeals, expiringCount]);

  const grantCounts = useMemo(() => {
    const grants = activeDeals.filter((d) => d.track === "grants");
    const count = (kind: GrantKind) =>
      grants.filter((d) => d.grantKind === kind).length;
    return {
      all: grants.length,
      climate: count("climate"),
      agriculture: count("agriculture"),
      education: count("education"),
      business: count("business"),
      ai: count("ai"),
      research: count("research"),
      development: count("development"),
      other: count("other"),
    };
  }, [activeDeals]);

  const hackathonCounts = useMemo(() => {
    const hackathons = activeDeals.filter((d) => d.track === "hackathons");
    const count = (kind: HackathonKind) =>
      hackathons.filter((d) => d.hackathonKind === kind).length;
    return {
      all: hackathons.length,
      web3: count("web3"),
      ai: count("ai"),
      robotics: count("robotics"),
      fintech: count("fintech"),
      software: count("software"),
      other: count("other"),
    };
  }, [activeDeals]);

  const competitionCounts = useMemo(() => {
    const competitions = activeDeals.filter(
      (d) => d.track === "competitions",
    );
    const count = (kind: CompetitionKind) =>
      competitions.filter((d) => d.competitionKind === kind).length;
    return {
      all: competitions.length,
      robotics: count("robotics"),
      ai: count("ai"),
      software: count("software"),
      research: count("research"),
      other: count("other"),
    };
  }, [activeDeals]);

  /** Funders of the grants currently in the feed, in first-seen order,
   * computed from the feed data at render time, never hardcoded. */
  const grantFunders = useMemo(() => {
    const seen = new Set<string>();
    activeDeals
      .filter((d) => d.track === "grants")
      .forEach((d) => seen.add(d.funder));
    return [...seen];
  }, [activeDeals]);

  const visible = useMemo(() => {
    let base =
      tab === "all"
        ? activeDeals
        : tab === "expiring"
          ? activeDeals.filter(isExpiringSoon)
          : tab === "archive"
            ? savedDeals
            : activeDeals.filter((d) => d.track === tab);

    if (tab === "grants" && grantFilter !== "all") {
      base = base.filter((d) => d.grantKind === grantFilter);
    }
    if (tab === "hackathons" && hackathonFilter !== "all") {
      base = base.filter((d) => d.hackathonKind === hackathonFilter);
    }
    if (tab === "competitions" && competitionFilter !== "all") {
      base = base.filter((d) => d.competitionKind === competitionFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((d) =>
        [d.title, d.eligibility, d.requirements, d.estimatedValue, d.riskNote, d.funder]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (filters.nigeria) base = base.filter(isOpenToNigeria);
    if (filters.worldwide) base = base.filter(isWorldwide);
    if (filters.freeNoCard) base = base.filter((d) => d.costType === "truly-free");
    if (filters.expiringSoon) base = base.filter(isExpiringSoon);
    if (filters.vettedOnly) base = base.filter((d) => d.verification === "verified");
    return base;
  }, [tab, grantFilter, hackathonFilter, competitionFilter, search, filters, activeDeals, savedDeals]);

  const toggleFilter = (key: keyof Filters) =>
    setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <a href="#top" className="flex items-center gap-2">
            <span className="block h-9 w-9 shrink-0" aria-hidden="true">
              <Hero3D compact />
            </span>
            <span className="text-lg font-semibold tracking-tight text-stone-900">
              Alpha Scout
            </span>
          </a>
          <div className="ml-auto flex items-center gap-2 text-xs text-stone-500">
            {userEmail ? (
              <>
                <button
                  type="button"
                  onClick={() => setAuthOpen(true)}
                  title={userEmail}
                  className="max-w-44 truncate font-medium text-stone-700 hover:text-stone-900"
                >
                  {userEmail}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const supabase = getBrowserSupabase();
                    if (supabase) await supabase.auth.signOut();
                    setUserEmail(null);
                    setUserId(null);
                    setCloudReady(false);
                  }}
                  className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-400"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:border-stone-400"
              >
                Sign in
              </button>
            )}
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (feedSource === "live" ? "bg-green-700" : "bg-stone-400")
              }
            />
            {feedSource === "live" ? "Live feed" : "Offline snapshot"}
            {lastSync ? (
              <span className="hidden text-stone-400 sm:inline">
                · Updated {lastSync}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-7xl px-4">
        {/* Hero */}
        <section className="grid items-center gap-6 py-10 md:grid-cols-2 md:py-14">
          <div>
            <p className="text-sm font-medium text-green-800">
              Free opportunities, open to Nigeria
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-stone-900 md:text-5xl">
              Free opportunities, verified and up to date.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-stone-600">
              Scholarships, grants, international internships, hackathons,
              competitions, remote jobs and free tools, checked against
              official sources and updated every 24 hours.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="#opportunities"
                className="inline-flex items-center gap-2 rounded-md bg-green-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-900"
              >
                Browse opportunities
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:border-stone-400"
              >
                How it works
              </a>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              {activeDeals.length} active opportunities · {expiringCount}{" "}
              closing soon
            </p>
          </div>
          <div>
            <Hero3D />
          </div>
        </section>

        {/* Stats */}
        <StatsBar
          activeCount={activeDeals.length}
          expiringCount={expiringCount}
          savedCount={savedDeals.length + archivedDeals.length}
          verifiedCount={verifiedCount}
          lastSync={lastSync}
          feedSource={feedSource}
        />

        {/* Opportunities */}
        <section id="opportunities" className="scroll-mt-20 pt-8">
          <nav
            aria-label="Categories"
            className="flex flex-wrap gap-1 border-b border-stone-200 max-sm:flex-nowrap max-sm:overflow-x-auto"
          >
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              const count = counts.get(id) ?? 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    if (id !== "grants") setGrantFilter("all");
                    if (id !== "hackathons") setHackathonFilter("all");
                    if (id !== "competitions") setCompetitionFilter("all");
                  }}
                  aria-pressed={active}
                  className={
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm " +
                    (active
                      ? "border-green-800 font-semibold text-stone-900"
                      : "border-transparent font-normal text-stone-500 hover:text-stone-800")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <span className="text-xs text-stone-400">{count}</span>
                </button>
              );
            })}
          </nav>

          {tab === "grants" ? (
            <div className="mt-4">
              {grantFunders.length > 0 ? (
                <p className="text-xs leading-relaxed text-stone-500">
                  Sources in this list: {grantFunders.join(", ")}.
                </p>
              ) : null}
              <SubFilters
                filters={GRANT_FILTERS}
                counts={grantCounts}
                active={grantFilter}
                onSelect={setGrantFilter}
                label="Grant types"
              />
            </div>
          ) : null}

          {tab === "hackathons" ? (
            <div className="mt-4">
              <SubFilters
                filters={HACKATHON_FILTERS}
                counts={hackathonCounts}
                active={hackathonFilter}
                onSelect={setHackathonFilter}
                label="Hackathon types"
              />
            </div>
          ) : null}

          {tab === "competitions" ? (
            <div className="mt-4">
              <SubFilters
                filters={COMPETITION_FILTERS}
                counts={competitionCounts}
                active={competitionFilter}
                onSelect={setCompetitionFilter}
                label="Competition types"
              />
            </div>
          ) : null}

          <div className="mt-4">
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onToggle={toggleFilter}
              resultCount={visible.length}
            />
          </div>

          {tab === "archive" &&
          savedDeals.length === 0 &&
          archivedDeals.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center">
              <Archive className="mx-auto h-8 w-8 text-stone-400" />
              <h2 className="mt-3 text-sm font-semibold text-stone-900">
                Archive is empty
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
                Tap Save on any opportunity to keep it here for later.
              </p>
            </div>
          ) : visible.length === 0 && archivedVisible.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center">
              <h2 className="text-sm font-semibold text-stone-900">
                No opportunities match this view
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
                Try clearing a filter, switching tabs, or searching for a
                different keyword.
              </p>
            </div>
          ) : (
            <>
              {visible.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visible.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      lastSync={lastSync}
                      saved={savedIds.includes(deal.id)}
                      onToggleSave={() => toggleSave(deal)}
                    />
                  ))}
                </div>
              ) : null}
              {archivedVisible.length > 0 ? (
                <div className="mt-8">
                  <h2 className="text-sm font-semibold text-stone-900">
                    Archived · {archivedVisible.length} expired saved{" "}
                    {archivedVisible.length === 1 ? "deal" : "deals"}
                  </h2>
                  <p className="mt-1 text-xs text-stone-500">
                    These closing dates have passed, so the deals left the
                    board. They stay here because you saved them.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {archivedVisible.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        lastSync={lastSync}
                        saved
                        onToggleSave={() => toggleSave(deal)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-stone-200 py-10">
          <h2 className="text-xl font-semibold tracking-tight text-stone-900">
            How it works
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS.map(({ title, text }) => (
              <div
                key={title}
                className="rounded-lg border border-stone-200 bg-white p-4"
              >
                <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
                  {text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-stone-200 py-6 text-center text-xs leading-relaxed text-stone-500">
          <p className="text-xs font-medium text-stone-600">A note</p>
          <p className="mx-auto mt-1 max-w-2xl">
            Always check eligibility, deadlines and terms on the official
            source before you apply. Listings change, and some sources are
            roundups, not the official page. Nothing on Alpha Scout asks
            you to pay to take part. Never pay an application, deposit or
            activation fee for a listing marked free.
          </p>
        </footer>
      </main>

      <AuthPanel
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        userEmail={userEmail}
        onSignedOut={() => {
          setUserEmail(null);
          setUserId(null);
          setCloudReady(false);
        }}
      />
      <Chatbot signedIn={userEmail !== null} />
    </div>
  );
}
