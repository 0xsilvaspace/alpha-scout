import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALPHA SCOUT — Global Zero-Cost Intelligence Terminal",
  description:
    "Verified free global opportunities — scholarships, remote jobs, AI credits, crypto grants, NFTs, banking, cloud and software — open to Nigerians. No deal requires payment.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
