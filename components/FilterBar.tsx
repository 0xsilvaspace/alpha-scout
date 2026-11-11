import { Clock, Globe, MapPin, Search, ShieldCheck } from "lucide-react";

export interface Filters {
  nigeria: boolean;
  worldwide: boolean;
  freeNoCard: boolean;
  expiringSoon: boolean;
}

export const EMPTY_FILTERS: Filters = {
  nigeria: false,
  worldwide: false,
  freeNoCard: false,
  expiringSoon: false,
};

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: Filters;
  onToggle: (key: keyof Filters) => void;
  resultCount: number;
}

const TOGGLES: { key: keyof Filters; label: string; icon: typeof Globe }[] = [
  { key: "nigeria", label: "Open to Nigeria", icon: MapPin },
  { key: "worldwide", label: "Worldwide", icon: Globe },
  { key: "freeNoCard", label: "100% Free (No Card)", icon: ShieldCheck },
  { key: "expiringSoon", label: "Expiring Soon (<48h)", icon: Clock },
];

export default function FilterBar({
  search,
  onSearchChange,
  filters,
  onToggle,
  resultCount,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search deals</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search title, requirement, benefit…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <span className="font-mono text-xs text-zinc-400">
          {resultCount} deal{resultCount === 1 ? "" : "s"} shown
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {TOGGLES.map(({ key, label, icon: Icon }) => {
          const active = filters[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(key)}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-300"
                  : "inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-300 hover:border-zinc-500"
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
