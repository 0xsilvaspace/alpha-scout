import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alpha Scout: Free Opportunities, Verified",
  description:
    "Free scholarships, grants, hackathons, remote jobs, AI tools, cloud and software, open to Nigerians. Checked against official sources and updated every 4 hours.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
