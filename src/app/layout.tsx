import type { Metadata } from "next";
import { DM_Mono, Manrope, Syne } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { NavBar, Footer } from "@/components/NavBar";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  title: "ProofMile Escrow — Verdicts by consensus",
  description:
    "Trustless milestone escrow with AI adjudication, live on GenLayer Studionet. Lock GEN, ship work, and let validator consensus settle the verdict.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${syne.variable} ${manrope.variable} ${dmMono.variable} antialiased`}
      >
        <WalletProvider>
          <NavBar />
          <main>{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
