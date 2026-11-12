import { Clock, Globe, GraduationCap, MapPin, Search, ShieldCheck } from "lucide-react";

export interface Filters {
  nigeria: boolean;
  worldwide: boolean;
  freeNoCard: boolean;
  expiringSoon: boolean;
  /** Narrow to opportunities relevant to AI UniPod UNILAG members
   * (robotics, making/fabrication, AI training, hackathons, builder
   * grants, student cloud credits — see UNIPOD_KEYWORDS in lib/classify). */
  unipod: boolean;
}

export const EMPTY_FILTERS: Filters = {
  nigeria: false,
  worldwide: false,
  freeNoCard: false,
  expiringSoon: false,
  unipod: false,
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
  { key: "freeNoCard", label: "Free, no card", icon: ShieldCheck },
  { key: "expiringSoon", label: "Closing soon", icon: Clock },
  { key: "unipod", label: "For UniPod members", icon: GraduationCap },
];

export default function FilterBar({
  search,
  onSearchChange,
  filters,
  onToggle,
  resultCount,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search opportunities</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search title, requirement, benefit…"
            className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          />
        </label>
        <span className="text-xs text-stone-500">
          {resultCount} {resultCount === 1 ? "opportunity" : "opportunities"} shown
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
                  ? "inline-flex items-center gap-1.5 rounded-full border border-green-800 bg-green-800 px-3 py-1.5 text-xs font-medium text-white"
                  : "inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-400"
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
