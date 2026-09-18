"use client";
/**
 * "Reavaliar conversas que já aconteceram" — só existe pra agente
 * `operation_mode==='operator_only'` (0272).
 *
 * Achado em produção (2026-09-18): os dois "Conferidor de Funil" nunca
 * rodaram um turno sequer — a guarda de "humano está atendendo" bloqueava
 * tudo, corrigido em `lib/agent-engine/agent/inbound-turn.ts`. Este botão é
 * o jeito de recuperar o atraso: reprocessa em lote as conversas de um
 * período, sem esperar mensagem nova. Dois passos de propósito — contar
 * ANTES de gastar — porque isto é IA rodando em lote, e ninguém deveria
 * disparar isso sem saber quantas conversas está prestes a acordar.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { AgentRow } from "@/hooks/ai/useAgent";

interface RespostaReavaliar {
  data: {
    dry_run: boolean;
    total: number;
    enfileiradas?: number;
    falhas?: number;
  };
}

export function ReavaliarHistorico({ agent, readOnly }: { agent: AgentRow; readOnly?: boolean }) {
  const t = useT();
  // Padrão: desde a criação do agente — editável pra reprocessar uma janela
  // menor ou maior (ex.: desde que o bug começou, não desde que o agente
  // nasceu).
  const [desde, setDesde] = useState(() => agent.created_at.slice(0, 10));
  const [contagem, setContagem] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<RespostaReavaliar["data"] | null>(null);

  if (agent.operation_mode !== "operator_only") return null;

  async function contar() {
    setBusy(true);
    setResultado(null);
    try {
      const res = await apiClient.post<RespostaReavaliar>(`/api/v1/ai/agents/${agent.id}/reavaliar`, {
        desde: new Date(`${desde}T00:00:00Z`).toISOString(),
        confirmar: false,
      });
      setContagem(res.data.total);
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirmar() {
    setBusy(true);
    try {
      const res = await apiClient.post<RespostaReavaliar>(`/api/v1/ai/agents/${agent.id}/reavaliar`, {
        desde: new Date(`${desde}T00:00:00Z`).toISOString(),
        confirmar: true,
      });
      setResultado(res.data);
      setContagem(null);
      toast.success(t("Reavaliação disparada"));
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-3" aria-label={t("Reavaliar conversas que já aconteceram")}>
      <div>
        <h3 className="text-sm font-medium">{t("Reavaliar conversas que já aconteceram")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            "Manda o agente organizar de novo as conversas de um período — útil quando ele ficou parado (ex.: bug corrigido) e o funil ficou desatualizado. Não reenvia nada ao cliente; só reorganiza o CRM.",
          )}
        </p>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        {t("Desde")}
        <input
          type="date"
          value={desde}
          disabled={readOnly || busy}
          onChange={(e) => {
            setDesde(e.target.value);
            setContagem(null);
            setResultado(null);
          }}
          data-testid="reavaliar-desde"
          className="rounded-md border bg-background p-1.5 text-sm"
        />
        <Button type="button" variant="outline" size="sm" disabled={readOnly || busy} onClick={() => void contar()} data-testid="reavaliar-contar">
          {t("Contar conversas")}
        </Button>
      </label>

      {contagem !== null ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3" data-testid="reavaliar-contagem">
          {contagem === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("Nenhuma conversa nesse período — nada para reavaliar.")}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{contagem}</span>{" "}
                {t(contagem === 1 ? "conversa vai ser reavaliada." : "conversas vão ser reavaliadas.")}
              </p>
              <Button type="button" size="sm" disabled={readOnly || busy} onClick={() => void confirmar()} data-testid="reavaliar-confirmar">
                {t("Confirmar e reavaliar")}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {resultado ? (
        <p className="text-xs text-muted-foreground" data-testid="reavaliar-resultado">
          {t("Disparado:")} <span className="font-medium text-foreground">{resultado.enfileiradas}</span>{" "}
          {t("de")} {resultado.total} {t("conversas")}
          {resultado.falhas && resultado.falhas > 0
            ? ` (${resultado.falhas} ${t("falharam ao disparar — tente de novo mais tarde")})`
            : ""}
          .
        </p>
      ) : null}
    </section>
  );
}
