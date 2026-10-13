import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsogo Sun | Performance Intelligence",
  description: "Monthly traffic, content and search insights across the Tsogo Sun casino and hotel portfolio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
