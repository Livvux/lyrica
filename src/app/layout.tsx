import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lyrica – Lyrics Video Generator",
  description: "Generiere automatisch Lyrics-Videos aus deinem Song.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className={`${inter.className} bg-black text-white antialiased`}>
        {children}
        <footer className="fixed bottom-0 inset-x-0 text-center text-[10px] text-white/20 py-1 pointer-events-none select-none">
          build {process.env.NEXT_PUBLIC_BUILD_TIME}
        </footer>
      </body>
    </html>
  );
}
