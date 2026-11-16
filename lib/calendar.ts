import type { ResolvedDeal } from "@/lib/classify";

/**
 * Google Calendar "Add to calendar" link for a saved deal with a
 * closing date. Uses Google's prefilled-event page, so no sign-in,
 * OAuth or backend is needed: the event opens in the user's own
 * Google Calendar, on whatever Google account is signed in there.
 * The event is all day on the deadline date, with the value and the
 * official source link in the description. Reminders follow the
 * user's Google Calendar defaults (they can add more when saving the
 * event). Returns null when the deal has no closing date.
 */
export function googleCalendarUrl(
  deal: Pick<
    ResolvedDeal,
    "title" | "estimatedValue" | "expiresOn" | "sourceUrl"
  >,
): string | null {
  if (!deal.expiresOn) return null;
  const start = deal.expiresOn.replace(/-/g, "");
  const endDate = new Date(`${deal.expiresOn}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  const details = [
    deal.estimatedValue ? `Value: ${deal.estimatedValue}` : null,
    `Closes: ${deal.expiresOn}`,
    `Source: ${deal.sourceUrl}`,
    "Saved from Alpha Scout.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: deal.title,
    dates: `${start}/${end}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
