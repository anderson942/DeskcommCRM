import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * "Reavaliar conversas que já aconteceram" (0272) — só existe pra
 * operation_mode='operator_only'. Cobre: escondido pra outros modos, conta
 * ANTES de disparar (dry run), só chama a rota com confirmar:true depois do
 * clique de confirmação.
 */

vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { apiClient } from "@/lib/api/client";
import { ReavaliarHistorico } from "./ReavaliarHistorico";
import type { AgentRow } from "@/hooks/ai/useAgent";

function agente(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Conferidor de Funil",
    operation_mode: "operator_only",
    created_at: "2026-09-17T00:00:00.000Z",
    ...over,
  } as AgentRow;
}

describe("ReavaliarHistorico", () => {
  it("não renderiza nada pra agente automatic — reemitir despacharia resposta de verdade", () => {
    render(<ReavaliarHistorico agent={agente({ operation_mode: "automatic" })} />);
    expect(screen.queryByText("Reavaliar conversas que já aconteceram")).not.toBeInTheDocument();
  });

  it("não renderiza nada pra agente assisted", () => {
    render(<ReavaliarHistorico agent={agente({ operation_mode: "assisted" })} />);
    expect(screen.queryByText("Reavaliar conversas que já aconteceram")).not.toBeInTheDocument();
  });

  it("clicar em 'Contar conversas' chama a rota com confirmar:false e mostra a contagem", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { dry_run: true, total: 16 } });
    render(<ReavaliarHistorico agent={agente()} />);

    fireEvent.click(screen.getByTestId("reavaliar-contar"));

    await waitFor(() => expect(screen.getByTestId("reavaliar-contagem")).toBeInTheDocument());
    expect(screen.getByTestId("reavaliar-contagem")).toHaveTextContent("16");
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/agents/33333333-3333-4333-8333-333333333333/reavaliar",
      expect.objectContaining({ confirmar: false }),
    );
    // Ainda não disparou nada — só contou.
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("contagem zero não mostra botão de confirmar", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { dry_run: true, total: 0 } });
    render(<ReavaliarHistorico agent={agente()} />);

    fireEvent.click(screen.getByTestId("reavaliar-contar"));

    await waitFor(() => expect(screen.getByTestId("reavaliar-contagem")).toBeInTheDocument());
    expect(screen.queryByTestId("reavaliar-confirmar")).not.toBeInTheDocument();
  });

  it("clicar em 'Confirmar e reavaliar' chama a rota com confirmar:true", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { dry_run: true, total: 2 } })
      .mockResolvedValueOnce({ data: { dry_run: false, total: 2, enfileiradas: 2, falhas: 0 } });
    render(<ReavaliarHistorico agent={agente()} />);

    fireEvent.click(screen.getByTestId("reavaliar-contar"));
    await waitFor(() => expect(screen.getByTestId("reavaliar-confirmar")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("reavaliar-confirmar"));

    await waitFor(() => expect(screen.getByTestId("reavaliar-resultado")).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/agents/33333333-3333-4333-8333-333333333333/reavaliar",
      expect.objectContaining({ confirmar: true }),
    );
    expect(screen.getByTestId("reavaliar-resultado")).toHaveTextContent("2");
    // A contagem some depois de confirmar — não fica um botão "confirmar" órfão.
    expect(screen.queryByTestId("reavaliar-confirmar")).not.toBeInTheDocument();
  });

  it("trocar a data zera a contagem — não deixa confirmar um número que já não vale mais", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { dry_run: true, total: 5 } });
    render(<ReavaliarHistorico agent={agente()} />);

    fireEvent.click(screen.getByTestId("reavaliar-contar"));
    await waitFor(() => expect(screen.getByTestId("reavaliar-contagem")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("reavaliar-desde"), { target: { value: "2026-09-01" } });

    expect(screen.queryByTestId("reavaliar-contagem")).not.toBeInTheDocument();
  });
});
