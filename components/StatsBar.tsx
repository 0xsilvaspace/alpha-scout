interface StatsBarProps {
  activeCount: number;
  expiringCount: number;
  savedCount: number;
  verifiedCount: number;
  lastSync: string;
  /** "live" = deals came from the GitHub feed; "snapshot" = baked-in fallback. */
  feedSource: "live" | "snapshot";
}

export default function StatsBar({
  activeCount,
  expiringCount,
  savedCount,
  verifiedCount,
  lastSync,
  feedSource,
}: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-500">Active deals</div>
        <div className="mt-1 text-3xl font-semibold text-stone-900">
          {activeCount}
        </div>
        <div className="mt-1 text-xs text-stone-500">
          {savedCount} saved · {expiringCount} closing soon
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-500">Closing soon</div>
        <div className="mt-1 text-3xl font-semibold text-stone-900">
          {expiringCount}
        </div>
        <div className="mt-1 text-xs text-stone-500">
          Deals closing within 48 hours
        </div>
      </div>

      <div className="col-span-2 rounded-lg border border-stone-200 bg-white p-4 lg:col-span-1">
        <div className="text-xs font-medium text-stone-500">Feed status</div>
        <div className="mt-2 flex items-center gap-2 text-base font-semibold text-stone-900">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (feedSource === "live" ? "bg-green-700" : "bg-stone-400")
            }
          />
          {feedSource === "live" ? "Live feed" : "Offline snapshot"}
        </div>
        <div className="mt-1 text-xs text-stone-500">
          Last updated: {lastSync}
        </div>
        <div className="mt-1 text-xs text-stone-500">
          {verifiedCount} of {activeCount} sources vetted
        </div>
      </div>
    </div>
  );
}
