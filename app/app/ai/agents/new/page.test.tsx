/**
 * A TELA DE CRIAR AGENTE BUSCA OS FUNIS DA ORG — MESMO QUE A DE EDITAR.
 *
 * Achado criando o "Conferidor de Funil" (2026-09-17): a tela de edição
 * (`[id]/page.tsx`) sempre buscou `crm_pipelines` e passou pra `AgentForm`;
 * a de criar (`new/page.tsx`) nunca buscou — `AgentForm` default `funis` pra
 * `[]` quando a prop falta, então "Em que negócios ele pode mexer" mostrava
 * "Você ainda não tem nenhum funil" mesmo numa org com funil cadastrado. Sem
 * marcar o funil na criação, o Operador nasce sem escopo nenhum — não move
 * negócio nenhum até alguém entrar na edição e descobrir isso por conta
 * própria.
 *
 * Este teste guarda o CALL SITE: a página passa `funis` não-vazio pra
 * `AgentForm` quando a org tem pipeline. Não teria pego o bug original
 * testando só `AgentForm` isolado — ele já tratava `funis` ausente
 * corretamente (default `[]`); o defeito era o CHAMADOR nunca entregar o
 * dado, exatamente a classe de lacuna que este arquivo existe pra fechar.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, resolveActiveOrgMock, listSelectableChannelsMock, agentFormMock } =
  vi.hoisted(() => ({
    requireAuthMock: vi.fn(),
    resolveActiveOrgMock: vi.fn(),
    listSelectableChannelsMock: vi.fn(),
    agentFormMock: vi.fn((_props: unknown) => null),
  }));

vi.mock("@/lib/auth/server", () => ({
  requireAuth: requireAuthMock,
  resolveActiveOrg: resolveActiveOrgMock,
}));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: listSelectableChannelsMock }));
vi.mock("@/lib/instalacao/ambiente", () => ({
  lerAmbiente: () => ({ chavesDeProvedor: {} }),
}));
vi.mock("../[id]/_components/AgentForm", () => ({
  AgentForm: (props: unknown) => agentFormMock(props),
}));

const PIPELINE_ROW = {
  id: "39e43ac8-7ce3-48fd-a1b0-d62311535773",
  name: "Vendas",
  slug: "vendas",
  description: null,
  position: 1000,
  is_default: true,
};

/**
 * Um `.from(table)` por chamada, encadeamento tolerante (qualquer `.eq`/
 * `.order` devolve o mesmo objeto), resolvendo pra `{ data }` fixo por
 * tabela — o suficiente pra exercitar o Server Component sem simular o
 * PostgREST inteiro.
 */
function fakeSupabase(porTabela: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const data = porTabela[table] ?? [];
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => Promise.resolve({ data })),
      then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data }),
    };
    return chain;
  });
  return { from };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    fakeSupabase({
      ai_provider_credentials_safe: [],
      crm_pipelines: [PIPELINE_ROW],
      crm_stages: [],
    }),
}));

import NewAgentPage from "./page";

afterEach(cleanup);

describe("NewAgentPage", () => {
  it("entrega à AgentForm os funis da org — não uma lista vazia por esquecimento", async () => {
    requireAuthMock.mockResolvedValue({ idioma: "pt-BR" });
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org-1", role: "admin" });
    listSelectableChannelsMock.mockResolvedValue([]);

    render(await NewAgentPage());

    expect(agentFormMock).toHaveBeenCalledOnce();
    const props = agentFormMock.mock.calls[0]![0] as { funis?: unknown[] };
    expect(
      props.funis,
      "AgentForm recebeu funis vazio/ausente — a tela de criar voltou a não buscar os pipelines da org",
    ).toEqual([PIPELINE_ROW]);
  });
});
