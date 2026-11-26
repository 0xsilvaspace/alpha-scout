"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Flag,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from "lucide-react";
import {
  daysLeft,
  formatUsd,
  isActive,
  isExpiringSoon,
  parseSteps,
} from "@/lib/deals";
import { googleCalendarUrl } from "@/lib/calendar";
import {
  COMPETITION_KIND_LABELS,
  DISPLAY_LABELS,
  GRANT_KIND_LABELS,
  HACKATHON_KIND_LABELS,
  type ResolvedDeal,
} from "@/lib/classify";

interface DealCardProps {
  deal: ResolvedDeal;
  /** True when this deal is saved to the user's archive. */
  saved?: boolean;
  /** Toggles the saved state for this deal. */
  onToggleSave?: () => void;
}

/** "2026-11-27" -> "27 Nov 2026". */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DealCard({ deal, saved = false, onToggleSave }: DealCardProps) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  // Feed text can contain em dashes; render them as commas instead.
  const clean = (text: string) =>
    text.replace(/\s*\u2014\s*/g, ", ").replace(/^, /, "");
  const title = clean(deal.title);
  const eligibility = clean(deal.eligibility);
  const estimatedValue = clean(deal.estimatedValue);
  const requirements = clean(deal.requirements);
  const funder = clean(deal.funder);
  const dLeft = daysLeft(deal);
  const closingSoon = isExpiringSoon(deal);
  // Saved deals with a closing date that has not passed get a direct
  // "Add to Google Calendar" link (Google's prefilled-event page, no
  // sign-in or backend needed). Expired deals get no link: the date
  // has passed, so there is nothing to be reminded about.
  const calendarUrl =
    saved && deal.expiresOn && isActive(deal)
      ? googleCalendarUrl(deal)
      : null;
  const steps = parseSteps(deal.actionSteps);
  // Risk notes come from the feed; a leading "URGENT:" marker is display
  // noise, so it is softened at render time without changing the data.
  const riskNote = clean(deal.riskNote.replace(/^URGENT:\s*/i, ""));
  const trackBadge =
    deal.track === "grants"
      ? `Grants · ${GRANT_KIND_LABELS[deal.grantKind ?? "other"]}`
      : deal.track === "hackathons"
        ? `Hackathons · ${HACKATHON_KIND_LABELS[deal.hackathonKind ?? "other"]}`
        : deal.track === "competitions"
          ? `Competitions · ${COMPETITION_KIND_LABELS[deal.competitionKind ?? "other"]}`
          : DISPLAY_LABELS[deal.track];

  // Closing date, always with the actual date and the days left, so a
  // reader can judge it without opening the official source.
  const expiryText =
    dLeft === null
      ? "Closes: Rolling / ongoing"
      : dLeft < 0
        ? `Closed ${formatDate(deal.expiresOn ?? "")} · ${Math.abs(dLeft)}d ago`
        : dLeft === 0
          ? `Closes: ${formatDate(deal.expiresOn ?? "")} · today`
          : dLeft === 1
            ? `Closes: ${formatDate(deal.expiresOn ?? "")} · in 1 day`
            : `Closes: ${formatDate(deal.expiresOn ?? "")} · in ${dLeft} days`;

  // Option C (Kenneth, 2026-11-26): the card body is a short Summary
  // of three bullets, built from the fields the feed already carries,
  // so no per-deal summary has to be written. Value and closing date
  // stay as their own lines above it. The per-card "Source checked"
  // line and the separate "Source" hostname line are gone; the only
  // last-updated time is the feed-level one at the top of the page.
  const summaryBullets = [
    estimatedValue,
    eligibility,
    requirements,
  ].filter(Boolean);

  return (
    <article
      className={
        "flex flex-col rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md " +
        (closingSoon ? "border-red-300" : "border-stone-200")
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
              <CheckCircle2 className="h-3 w-3" /> Source vetted
            </>
          ) : (
            <>
              <Clock className="h-3 w-3" /> Not yet vetted
            </>
          )}
        </span>
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? "Remove from archive" : "Save to archive"}
          title={saved ? "Saved to archive" : "Save to archive"}
          className={
            "inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium " +
            (saved
              ? "bg-green-800 text-white"
              : "border border-stone-300 text-stone-600 hover:border-stone-400")
          }
        >
          <Bookmark className="h-3 w-3" fill={saved ? "currentColor" : "none"} />
          {saved ? "Saved" : "Save"}
        </button>
        {calendarUrl ? (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Add the closing date to your Google Calendar"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-stone-300 px-2 py-0.5 text-[11px] font-medium text-stone-600 hover:border-stone-400"
          >
            <CalendarClock className="h-3 w-3" />
            Calendar
          </a>
        ) : null}
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-stone-900">
        {title}
      </h3>

      <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed">
        <p>
          <span className="text-xs font-medium text-stone-500">
            Value ·{" "}
          </span>
          <span className="font-semibold text-stone-900">
            {deal.valueUsd !== null ? formatUsd(deal.valueUsd) : "Not stated"}
          </span>
        </p>
        <p
          className={
            "flex items-center gap-1.5 text-[13px] " +
            (closingSoon
              ? "font-semibold text-red-700"
              : dLeft === null
                ? "text-stone-500"
                : "font-medium text-amber-800")
          }
        >
          {closingSoon ? (
            <Timer className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          )}
          {expiryText}
        </p>
      </div>

      <div className="mt-3 rounded-r-lg border-l-[3px] border-green-800 bg-stone-50 p-3">
        <p className="text-xs font-semibold text-stone-900">Summary</p>
        <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-stone-600">
          {summaryBullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
          {deal.track === "grants" ? <li>Funded by {funder}.</li> : null}
        </ul>
      </div>

      {riskNote ? (
        <p className="mt-3 flex items-start gap-1.5 rounded border border-stone-200 bg-stone-50 p-2 text-xs text-stone-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>
            <span className="font-semibold text-stone-700">
              Before you apply:{" "}
            </span>
            {riskNote}
          </span>
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-700 hover:border-stone-300"
        >
          <span>How to apply ({steps.length} steps)</span>
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
                {clean(step)}
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
          {reported ? "Report noted, thanks" : "Report expired / suspicious"}
        </button>
      </div>
      {reported ? (
        <p className="mt-2 text-[11px] text-stone-500">
          Flagged locally on this device only. No data is sent anywhere.
        </p>
      ) : null}
    </article>
  );
}
