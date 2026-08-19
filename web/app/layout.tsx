import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { ConnectButton } from "@/src/components/ConnectButton";
import { Footer } from "@/src/components/Footer";
import { Providers } from "./providers";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
});

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
    <html lang="en" className={fraunces.variable}>
      <body>
        <Providers>
          <div id="app-root" className="mx-auto max-w-3xl px-6 py-10">
            <header className="mb-12 flex items-center justify-between">
              <span className="font-serif text-xl font-medium tracking-tight">
                Ritual Predict
              </span>
              <ConnectButton />
            </header>
            <main>{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
