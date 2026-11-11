import { Activity, DollarSign, Layers, Timer } from "lucide-react";
import { formatUsd } from "@/lib/deals";

interface StatsBarProps {
  activeCount: number;
  totalValue: number;
  expiringCount: number;
  archivedCount: number;
  lastSync: string;
  /** "live" = deals came from the GitHub feed; "snapshot" = baked-in fallback. */
  feedSource: "live" | "snapshot";
}

export default function StatsBar({
  activeCount,
  totalValue,
  expiringCount,
  archivedCount,
  lastSync,
  feedSource,
}: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          <Layers className="h-3.5 w-3.5 text-emerald-400" />
          Active deals
        </div>
        <div className="mt-2 font-mono text-3xl font-bold text-zinc-50">{activeCount}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {archivedCount} archived · {expiringCount} expiring soon
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
          Total value tracked
        </div>
        <div className="mt-2 font-mono text-3xl font-bold text-emerald-400 glow-text">
          {formatUsd(totalValue)}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          Sum of USD values where stated; benefit-only deals excluded
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          <Timer className="h-3.5 w-3.5 text-amber-400" />
          Expiring soon
        </div>
        <div className="mt-2 font-mono text-3xl font-bold text-amber-300">{expiringCount}</div>
        <div className="mt-1 text-xs text-zinc-500">Deals closing within 48 hours</div>
      </div>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-emerald-300">
          <Activity className="h-3.5 w-3.5" />
          System status
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-lg font-bold text-emerald-300">
          <span className="pulse-dot inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 glow-emerald" />
          Online / Auto-Syncing
        </div>
        <div className="mt-1 text-xs text-zinc-400">Last sync: {lastSync}</div>
        <div className="mt-1.5">
          {feedSource === "live" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live feed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
              Offline snapshot
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
