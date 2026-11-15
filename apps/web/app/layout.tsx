import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { bimThemeVariables } from "@/lib/design-tokens";

export const metadata: Metadata = {
  title: "Інтелектуальна BIM-система",
  description: "Перевірка й підготовка креслень пожежної сигналізації",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk" style={bimThemeVariables}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
