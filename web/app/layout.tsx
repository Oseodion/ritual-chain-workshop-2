import type { Metadata } from "next";
import { ConnectButton } from "@/src/components/ConnectButton";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ritual Predict",
  description: "Self-resolving prediction markets on Ritual Chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
            <header className="mb-10 flex items-center justify-between">
              <span className="text-lg font-semibold tracking-tight">
                Ritual Predict
              </span>
              <ConnectButton />
            </header>
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
