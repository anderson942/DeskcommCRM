/**
 * POST /api/v1/ai/agents/:id/reavaliar (0272).
 *
 * ⚠️ O QUE ESTE ARQUIVO GUARDA: a rota (a) só existe pra operation_mode
 * 'operator_only' — pra qualquer outro modo, reemitir o despacho faria o
 * agente responder de verdade a uma mensagem antiga, que não é o que foi
 * pedido; (b) `confirmar:false` (padrão) é DRY RUN — não emite nada, só
 * conta; (c) só emite quando `confirmar:true`, um evento por conversa
 * elegível, usando a última mensagem inbound de cada uma. O ranqueamento da
 * consulta (`fn_conversas_para_reavaliar`) já é responsabilidade do SQL —
 * não repetido aqui.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const CANAL = "55555555-5555-4555-8555-555555555555";

interface AgenteFake {
  operation_mode: string | null;
  published_version_id: string | null;
  archived_at: string | null;
}

function stubAdmin(agente: AgenteFake, conversas: Array<Record<string, unknown>>) {
  const chamadasRpc: Array<{ nome: string; params: Record<string, unknown> }> = [];
  const admin = {
    from: (tabela: string) => {
      if (tabela === "ai_agents") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: AGENT, name: "Conferidor", ...agente },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // ai_agent_versions
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: VERSION, channel_session_id: CANAL },
              error: null,
            }),
          }),
        }),
      };
    },
    rpc: (nome: string, params: Record<string, unknown>) => {
      chamadasRpc.push({ nome, params });
      if (nome === "fn_conversas_para_reavaliar") {
        return Promise.resolve({ data: conversas, error: null });
      }
      // emit_event
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin, chamadasRpc };
}

function pedido(corpo: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/ai/agents/${AGENT}/reavaliar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

const CONVERSAS_FAKE = [
  { conversation_id: "c1", contact_id: "p1", ultima_mensagem_inbound_id: "m1" },
  { conversation_id: "c2", contact_id: "p2", ultima_mensagem_inbound_id: "m2" },
];

beforeEach(() => {
  vi.clearAllMocks();
  const user: AuthUser = {
    id: USER,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: "admin" }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK["admin"] >= ROLE_RANK[min]
      ? { ok: true, user, org: { orgId: ORG, name: "Org", role: "admin" } }
      : ({ ok: false, response: null } as never),
  );
});

describe("POST /reavaliar — só existe pra operator_only", () => {
  it("recusa agente automatic com 409 — reemitir despacharia resposta de verdade", async () => {
    const { admin } = stubAdmin(
      { operation_mode: "automatic", published_version_id: VERSION, archived_at: null },
      [],
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    const res = await POST(pedido({ desde: "2026-09-17T00:00:00Z" }), {
      params: Promise.resolve({ id: AGENT }),
    });

    expect(res.status).toBe(409);
  });

  it("recusa agente assisted com 409, pela mesma razão", async () => {
    const { admin } = stubAdmin(
      { operation_mode: "assisted", published_version_id: VERSION, archived_at: null },
      [],
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    const res = await POST(pedido({ desde: "2026-09-17T00:00:00Z" }), {
      params: Promise.resolve({ id: AGENT }),
    });

    expect(res.status).toBe(409);
  });
});

describe("POST /reavaliar — confirmar:false é dry run", () => {
  it("conta as conversas elegíveis SEM chamar emit_event", async () => {
    const { admin, chamadasRpc } = stubAdmin(
      { operation_mode: "operator_only", published_version_id: VERSION, archived_at: null },
      CONVERSAS_FAKE,
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    const res = await POST(pedido({ desde: "2026-09-17T00:00:00Z", confirmar: false }), {
      params: Promise.resolve({ id: AGENT }),
    });
    const corpo = (await res.json()) as { data: { dry_run: boolean; total: number } };

    expect(res.status).toBe(200);
    expect(corpo.data).toEqual({ dry_run: true, total: 2 });
    expect(chamadasRpc.map((c) => c.nome)).toEqual(["fn_conversas_para_reavaliar"]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("consulta a rede larga com a organização de fonte confiável, não do body", async () => {
    const { admin, chamadasRpc } = stubAdmin(
      { operation_mode: "operator_only", published_version_id: VERSION, archived_at: null },
      [],
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    await POST(pedido({ desde: "2026-09-17T00:00:00Z" }), { params: Promise.resolve({ id: AGENT }) });

    expect(chamadasRpc[0]!.params).toMatchObject({
      p_organization_id: ORG,
      p_channel_session_id: CANAL,
    });
  });
});

describe("POST /reavaliar — confirmar:true dispara um evento por conversa", () => {
  it("chama emit_event uma vez por conversa elegível, com a última mensagem inbound de cada uma", async () => {
    const { admin, chamadasRpc } = stubAdmin(
      { operation_mode: "operator_only", published_version_id: VERSION, archived_at: null },
      CONVERSAS_FAKE,
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    const res = await POST(pedido({ desde: "2026-09-17T00:00:00Z", confirmar: true }), {
      params: Promise.resolve({ id: AGENT }),
    });
    const corpo = (await res.json()) as {
      data: { dry_run: boolean; total: number; enfileiradas: number; falhas: number };
    };

    expect(res.status).toBe(200);
    expect(corpo.data).toEqual({ dry_run: false, total: 2, enfileiradas: 2, falhas: 0 });

    const emissoes = chamadasRpc.filter((c) => c.nome === "emit_event");
    expect(emissoes).toHaveLength(2);
    expect(emissoes.map((e) => (e.params.p_entity_id as string))).toEqual(["m1", "m2"]);
    expect(emissoes[0]!.params).toMatchObject({
      p_event_type: "ai_agent.dispatch_requested",
      p_payload: expect.objectContaining({
        channel_session_id: CANAL,
        inbound_message_id: "m1",
        conversation_id: "c1",
        contact_id: "p1",
      }),
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_agent.reavaliado", resourceId: AGENT }),
    );
  });

  it("zero conversas elegíveis não chama emit_event nenhuma vez", async () => {
    const { admin, chamadasRpc } = stubAdmin(
      { operation_mode: "operator_only", published_version_id: VERSION, archived_at: null },
      [],
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const { POST } = await import("./route");

    await POST(pedido({ desde: "2026-09-17T00:00:00Z", confirmar: true }), {
      params: Promise.resolve({ id: AGENT }),
    });

    expect(chamadasRpc.filter((c) => c.nome === "emit_event")).toHaveLength(0);
  });
});

// Este teste isola o handler; autoridade de suporte é exercitada na suíte própria.
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/impersonate/support")>()),
  requireSupportWrite: vi.fn(async () => null),
  authenticatedSessionId: vi.fn(async () => "f2200000-0000-4000-8000-000000000099"),
}));
