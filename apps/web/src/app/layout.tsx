import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";

export const metadata: Metadata = {
  title: "BREAKPOINT  Local control rehearsal",
  description: "Discover shared Safe control, rehearse a withdrawal pause, and verify a configuration improvement."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
