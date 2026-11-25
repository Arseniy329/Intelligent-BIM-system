"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";

export type AppHeaderNavItem = {
  href: string;
  label: string;
};

export function AppHeader({
  navItems = [],
}: {
  navItems?: AppHeaderNavItem[];
}) {
  const pathname = usePathname();
  const workspace = pathname === "/drawing-preview" || /^\/drawings\/[^/]+$/.test(pathname ?? "");
  return <header className="drawing-workspace-header">
    <Link href={workspace ? "/drawings" : "/upload"} className="drawing-workspace-brand">
      <Image src="/design/bim-107/logo.svg" width={40} height={40} alt="" unoptimized />
      <span><strong>Інтелектуальна BIM</strong><small>Пожежна безпека</small></span>
    </Link>
    <div className="drawing-workspace-account">
      <Link href="/upload" className="drawing-workspace-new">＋ Нове креслення</Link>
      <details><summary aria-label="Меню облікового запису" /><nav aria-label="Основна навігація">
        <Link href="/drawings">Мої креслення</Link>
        {navItems.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        <LogoutButton />
      </nav></details>
    </div>
  </header>;
}
