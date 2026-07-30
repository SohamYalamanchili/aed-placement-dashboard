import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AED Placement Lab · UT Dallas",
  description: "Interactive simulated AED coverage, demand-model, and placement-optimization dashboard for UT Dallas.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
