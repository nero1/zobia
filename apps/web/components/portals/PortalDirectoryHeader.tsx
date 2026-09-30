"use client";

import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

export function PortalDirectoryHeader() {
  const { t } = useTranslation();
  return (
    <header>
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
        <Icon emoji="🧭" size={24} /> {t("portals.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("portals.subtitle")}</p>
    </header>
  );
}
