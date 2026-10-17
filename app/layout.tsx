import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Variable, with the optical-size axis: large headings and prices use the
// finer display cut instead of the text cut.
const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["opsz"],
});

const description = "Chat to check availability, get an exact quote and book Room A or Room B, with email confirmation.";

// Absolute URLs for link previews. Vercel provides the production domain.
const siteUrl =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Room Booking Assistant · Eastern Essence Studio",
  description,
  openGraph: { title: "Room Booking Assistant", description, type: "website" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full antialiased`}
    >
      {/* Extensions such as Grammarly add attributes to <body> before hydration. */}
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
