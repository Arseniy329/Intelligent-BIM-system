import Image from "next/image";
import type { ReactNode } from "react";

/** Desktop 1/2. Promotional drawing is the original standalone Frame 117 asset. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-layout">
    <aside className="auth-story">
      <div>
        <p className="auth-eyebrow">ПОЖЕЖНА БЕЗПЕКА</p>
        <h2>Від креслення —<br />до зрозумілого плану.</h2>
        <p className="auth-description">Простір для роботи з приміщеннями та системами пожежної сигналізації.</p>
        <Image className="auth-plan" src="/design/bim-107/auth-plan.svg" width={520} height={357} alt="Приклад плану поверху з умовними позначеннями приладів" unoptimized />
        <p className="auth-steps">01 / Завантажте план&nbsp;&nbsp; 02 / Досліджуйте результат</p>
      </div>
    </aside>
    <section className="auth-content"><div className="auth-form-card">
      <Image src="/design/bim-107/logo.svg" width={64} height={64} alt="Інтелектуальна BIM" unoptimized />
      {children}
    </div></section>
  </main>;
}
