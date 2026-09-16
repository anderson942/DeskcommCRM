"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check } from "@/lib/ui/icons";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";

export function CopyWebhookUrl({ url }: { url: string }) {
  const t = useT();
  const [copiado, setCopiado] = useState(false);

  async function onCopy() {
    const ok = await copyToClipboard(url);
    if (!ok) {
      toast.error(t("Não consegui copiar — selecione e copie manualmente."));
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button type="button" variant="outline" size="icon" onClick={onCopy} aria-label={t("Copiar")}>
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
