import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LayoutShell } from "@/components/layout-shell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SafeCare Admin Dashboard",
  description: "Mutual Aid Delivery System - Admin Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
