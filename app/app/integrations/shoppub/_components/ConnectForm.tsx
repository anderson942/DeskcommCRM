"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectShoppub } from "@/app/actions/integrations/connectShoppub";
import { disconnectShoppub } from "@/app/actions/integrations/disconnectShoppub";
import { useT } from "@/hooks/i18n/useT";

const CONNECT_ERRORS: Record<string, string> = {
  auth_required: "Faça login para conectar.",
  no_active_org: "Nenhuma organização ativa.",
  forbidden: "Apenas admins podem conectar integrações.",
  subdominio_invalido: "Subdomínio inválido — use só a parte antes de .shoppub.com.br.",
  token_vazio: "Cole o token da API.",
  token_invalido: "Token recusado pela Shoppub — confira se copiou certo.",
  falha_ao_testar: "Não consegui testar a credencial agora — tente de novo.",
  falha_ao_criptografar: "Falha ao guardar a credencial com segurança.",
  db_error: "Falha de banco ao salvar a conexão.",
};

const DISCONNECT_ERRORS: Record<string, string> = {
  auth_required: "Faça login para desconectar.",
  no_active_org: "Nenhuma organização ativa.",
  forbidden: "Apenas admins podem desconectar.",
  not_connected: "Integração não está conectada.",
  db_error: "Falha de banco ao desconectar.",
};

export function ConnectForm({ disabled }: { disabled?: boolean }) {
  const t = useT();
  const [subdominio, setSubdominio] = useState("");
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.set("subdominio", subdominio);
    form.set("token", token);
    startTransition(async () => {
      const res = await connectShoppub(form);
      if (res.ok) {
        toast.success(t("Shoppub conectada — o catálogo começa a sincronizar em instantes."));
        setToken("");
      } else {
        toast.error(t(CONNECT_ERRORS[res.error] ?? `Erro: ${res.error}`));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="shoppub-subdominio">{t("Endereço da loja")}</Label>
        <Input
          id="shoppub-subdominio"
          placeholder="outlet360.com.br"
          value={subdominio}
          onChange={(e) => setSubdominio(e.target.value)}
          disabled={disabled || pending}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {t("O domínio da sua loja (o que o cliente acessa) ou o subdomínio da Shoppub — pode colar a URL inteira que eu extraio.")}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shoppub-token">{t("Token da API")}</Label>
        <Input
          id="shoppub-token"
          type="password"
          placeholder="••••••••••••••••"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={disabled || pending}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {t("Gerado em Usuários → Usuário API, na área admin da sua loja Shoppub.")}
        </p>
      </div>
      <Button type="submit" disabled={disabled || pending} className="self-start">
        {pending ? t("Testando…") : t("Conectar")}
      </Button>
    </form>
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
          const res = await disconnectShoppub();
          if (res.ok) {
            toast.success(t("Shoppub desconectada."));
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
