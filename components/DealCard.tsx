"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Flag,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  daysLeft,
  formatUsd,
  isExpiringSoon,
  parseSteps,
} from "@/lib/deals";
import {
  DISPLAY_LABELS,
  type ResolvedDeal,
} from "@/lib/classify";

interface DealCardProps {
  deal: ResolvedDeal;
  /** Feed last-sync time (e.g. "12 Nov 2026, 12:48"), shown on grant
   * cards as the time their source was last checked. This is the feed's
   * sync time, not a per-URL live check. */
  lastSync?: string;
}

export default function DealCard({ deal, lastSync }: DealCardProps) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const dLeft = daysLeft(deal);
  const closingSoon = isExpiringSoon(deal);
  const steps = parseSteps(deal.actionSteps);
  // Risk notes come from the feed; a leading "URGENT:" marker is display
  // noise, so it is softened at render time without changing the data.
  const riskNote = deal.riskNote.replace(/^URGENT:\s*/i, "");
  const trackBadge =
    deal.track === "grants"
      ? `Grants · ${deal.grantKind === "ai" ? "AI" : "Other"}`
      : DISPLAY_LABELS[deal.track];

  const expiryText =
    dLeft === null
      ? "Ongoing"
      : dLeft < 0
        ? `Closed ${Math.abs(dLeft)}d ago`
        : dLeft === 0
          ? "Closes today"
          : deal.expiresOn
            ? `Closes ${deal.expiresOn}`
            : dLeft === 1
              ? "Closes in 1 day"
              : `Closes in ${dLeft} days`;

  return (
    <article
      className={
        "flex flex-col rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md " +
        (closingSoon ? "border-amber-300" : "border-stone-200")
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-stone-200 bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
          {trackBadge}
        </span>
        <span
          className={
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium " +
            (deal.costType === "truly-free"
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800")
          }
        >
          {deal.costType === "truly-free" ? (
            <>
              <ShieldCheck className="h-3 w-3" /> Free · No card
            </>
          ) : (
            <>
              <ShieldAlert className="h-3 w-3" /> Free trial · Card required
            </>
          )}
        </span>
        <span
          className={
            "ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium " +
            (deal.verification === "verified"
              ? "bg-green-50 text-green-800"
              : "bg-stone-100 text-stone-500")
          }
        >
          {deal.verification === "verified" ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Verified
            </>
          ) : (
            "Pending verification"
          )}
        </span>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-stone-900">
        {deal.title}
      </h3>

      <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed">
        <p>
          <span className="text-xs font-medium text-stone-500">
            Value ·{" "}
          </span>
          <span className="font-semibold text-stone-900">
            {deal.valueUsd !== null ? formatUsd(deal.valueUsd) : "—"}
          </span>{" "}
          <span className="text-stone-500">{deal.estimatedValue}</span>
        </p>
        <p className="text-stone-600">
          <span className="text-xs font-medium text-stone-500">
            Eligibility ·{" "}
          </span>
          {deal.eligibility}
        </p>
        {deal.track === "grants" ? (
          <>
            <p className="text-stone-600">
              <span className="text-xs font-medium text-stone-500">
                Funded by ·{" "}
              </span>
              <span className="font-semibold text-stone-900">{deal.funder}</span>
            </p>
            {lastSync && lastSync !== "—" ? (
              <p className="text-xs text-stone-500">
                Source checked {lastSync}
              </p>
            ) : null}
          </>
        ) : null}
        <p
          className={
            "flex items-center gap-1.5 text-xs " +
            (closingSoon ? "font-semibold text-amber-800" : "text-stone-500")
          }
        >
          {closingSoon ? (
            <Clock className="h-3.5 w-3.5" />
          ) : (
            <CalendarClock className="h-3.5 w-3.5" />
          )}
          {expiryText}
        </p>
        <p className="text-stone-600">
          <span className="text-xs font-medium text-stone-500">
            Requirements ·{" "}
          </span>
          {deal.requirements}
        </p>
        {riskNote ? (
          <p className="flex items-start gap-1.5 rounded border border-stone-200 bg-stone-50 p-2 text-xs text-stone-600">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
            <span>{riskNote}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-700 hover:border-stone-300"
        >
          <span>Steps ({steps.length})</span>
          <ChevronDown
            className={"h-4 w-4 transition-transform " + (open ? "rotate-180" : "")}
          />
        </button>
        {open ? (
          <ol className="mt-2 space-y-1.5 border-l-2 border-green-800/30 pl-3">
            {steps.map((step, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-stone-600">
                <span className="mr-1.5 text-xs font-semibold text-green-800">
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-stone-200 pt-3">
        <a
          href={deal.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-800 px-3 py-2 text-sm font-semibold text-white hover:bg-green-900"
        >
          <ExternalLink className="h-4 w-4" />
          Official source
        </a>
        <button
          type="button"
          onClick={() => setReported(true)}
          disabled={reported}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs " +
            (reported
              ? "border-green-800/40 bg-green-50 text-green-800"
              : "border-stone-300 text-stone-600 hover:border-stone-400")
          }
        >
          <Flag className="h-3.5 w-3.5" />
          {reported ? "Report noted — thanks" : "Report expired / suspicious"}
        </button>
      </div>
      {reported ? (
        <p className="mt-2 text-[11px] text-stone-500">
          Flagged locally on this device only — no data is sent anywhere.
        </p>
      ) : null}
    </article>
  );
}
