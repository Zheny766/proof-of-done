import type { Metadata } from "next";
import { Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Headlines only: a serif makes the deal pages read like a product, not an admin panel.
const display = Instrument_Serif({
  variable: "--font-instrument",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s · Proof of Done",
    default: "Proof of Done - PayPal escrow verified by AI",
  },
  description:
    "Escrow for work done by people or AI agents: PayPal holds the money, Claude checks the delivery against every criterion, models from two companies double-check, and PayPal pays out.",
  // Absolute URLs for the link preview image (app/opengraph-image.png).
  metadataBase: new URL(process.env.POD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"),
  openGraph: { siteName: "Proof of Done", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} ${inter.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
