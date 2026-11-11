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
  TRACK_LABELS,
  type Deal,
} from "@/lib/deals";

interface DealCardProps {
  deal: Deal;
}

export default function DealCard({ deal }: DealCardProps) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const dLeft = daysLeft(deal);
  const urgent = isExpiringSoon(deal);
  const steps = parseSteps(deal.actionSteps);

  const expiryText =
    dLeft === null
      ? "Ongoing"
      : dLeft < 0
        ? `Expired ${Math.abs(dLeft)}d ago`
        : dLeft === 0
          ? "Expires today"
          : dLeft === 1
            ? "Expires in 1 day"
            : `Expires in ${dLeft} days`;

  return (
    <article
      className={
        "flex flex-col rounded-lg border bg-zinc-900/80 p-4 transition-colors " +
        (urgent
          ? "border-amber-500/50 shadow-[0_0_24px_rgba(245,158,11,0.12)]"
          : "border-zinc-800 hover:border-emerald-500/40")
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
          {TRACK_LABELS[deal.track]}
        </span>
        <span
          className={
            "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider " +
            (deal.costType === "truly-free"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300")
          }
        >
          {deal.costType === "truly-free" ? (
            <>
              <ShieldCheck className="h-3 w-3" /> Truly Free · No Card
            </>
          ) : (
            <>
              <ShieldAlert className="h-3 w-3" /> Free Trial · Card Required
            </>
          )}
        </span>
        <span
          className={
            "ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider " +
            (deal.verification === "verified"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-zinc-800 text-zinc-400")
          }
        >
          {deal.verification === "verified" ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Verified
            </>
          ) : (
            "Pending Verification"
          )}
        </span>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-zinc-50">
        {deal.title}
      </h3>

      <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed">
        <p>
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Value ·{" "}
          </span>
          <span className="font-semibold text-emerald-300">
            {deal.valueUsd !== null ? formatUsd(deal.valueUsd) : "—"}
          </span>{" "}
          <span className="text-zinc-400">{deal.estimatedValue}</span>
        </p>
        <p className="text-zinc-400">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Eligibility ·{" "}
          </span>
          {deal.eligibility}
        </p>
        <p
          className={
            "flex items-center gap-1.5 font-mono text-xs " +
            (urgent ? "font-bold text-amber-300" : "text-zinc-400")
          }
        >
          {urgent ? (
            <Clock className="h-3.5 w-3.5" />
          ) : (
            <CalendarClock className="h-3.5 w-3.5" />
          )}
          {expiryText}
          {deal.expiresOn ? ` · ${deal.expiresOn}` : ""}
        </p>
        <p className="text-zinc-400">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Requirements ·{" "}
          </span>
          {deal.requirements}
        </p>
        {deal.riskNote ? (
          <p className="flex items-start gap-1.5 rounded border border-zinc-800 bg-zinc-950/70 p-2 text-xs text-zinc-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>{deal.riskNote}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded border border-zinc-800 bg-zinc-950/70 px-3 py-2 font-mono text-xs font-semibold text-zinc-200 hover:border-emerald-500/40"
        >
          <span>Action steps ({steps.length})</span>
          <ChevronDown
            className={"h-4 w-4 transition-transform " + (open ? "rotate-180" : "")}
          />
        </button>
        {open ? (
          <ol className="mt-2 space-y-1.5 border-l-2 border-emerald-500/40 pl-3">
            {steps.map((step, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-zinc-300">
                <span className="mr-1.5 font-mono text-xs font-bold text-emerald-400">
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-zinc-800 pt-3">
        <a
          href={deal.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          <ExternalLink className="h-4 w-4" />
          Open Official Source
        </a>
        <button
          type="button"
          onClick={() => setReported(true)}
          disabled={reported}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-mono text-xs " +
            (reported
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 text-zinc-300 hover:border-red-500/50 hover:text-red-300")
          }
        >
          <Flag className="h-3.5 w-3.5" />
          {reported ? "Report noted — thanks" : "Report Expired / Suspicious"}
        </button>
      </div>
      {reported ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          Flagged locally on this device only — no data is sent anywhere.
        </p>
      ) : null}
    </article>
  );
}
