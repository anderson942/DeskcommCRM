"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { connectTiny } from "@/app/actions/integrations/connectTiny";
import { disconnectTiny } from "@/app/actions/integrations/disconnectTiny";
import { useT } from "@/hooks/i18n/useT";

const CONNECT_ERRORS: Record<string, string> = {
  auth_required: "Faça login para conectar.",
  no_active_org: "Nenhuma organização ativa.",
  forbidden: "Apenas admins podem conectar integrações.",
  not_configured: "Integração não configurada — configure as credenciais em .env.",
};

const DISCONNECT_ERRORS: Record<string, string> = {
  auth_required: "Faça login para desconectar.",
  no_active_org: "Nenhuma organização ativa.",
  forbidden: "Apenas admins podem desconectar.",
  not_connected: "Integração não está conectada.",
  db_error: "Falha de banco ao desconectar.",
};

export function ConnectButton({ disabled }: { disabled?: boolean }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      onClick={() =>
        startTransition(async () => {
          const res = await connectTiny();
          if (res && !res.ok) {
            toast.error(t(CONNECT_ERRORS[res.error] ?? `Erro: ${res.error}`));
          }
        })
      }
      disabled={disabled || pending}
    >
      {pending ? t("Redirecionando…") : t("Conectar com a Tiny")}
    </Button>
  );
}

export function DisconnectButton() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      onClick={() =>
        startTransition(async () => {
          const res = await disconnectTiny();
          if (res.ok) {
            toast.success(t("Tiny desconectada."));
          } else {
            toast.error(t(DISCONNECT_ERRORS[res.error] ?? `Erro: ${res.error}`));
          }
        })
      }
      disabled={pending}
    >
      {pending ? t("Desconectando…") : t("Desconectar")}
    </Button>
  );
}
