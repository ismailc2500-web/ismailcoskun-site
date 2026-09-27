import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { activeSeriesId } from "@/lib/active";

export const metadata: Metadata = {
  title: "Fruit Saga Studio",
  description: "Local-first production studio for serialized fruit-headed fantasy shorts.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const seriesId = await activeSeriesId();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar activeSeries={seriesId} />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
