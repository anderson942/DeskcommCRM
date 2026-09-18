/**
 * O OPERADOR NUNCA FALA COM O CLIENTE — MAS SEGUE ORGANIZANDO O CRM MESMO COM
 * UM HUMANO NA CONVERSA.
 *
 * ## A virada de 2026-09-18
 *
 * Até aqui, `isLeadInHandoff` (force_human OU bot_silenced_until no futuro)
 * fazia o Operador pular o turno inteiro — nem lia a declaração, nem escrevia
 * no CRM. A razão original: "escrever no CRM por cima de quem assumiu". Mas o
 * Operador NUNCA teve `send_message` (é `operator_only` por ausência de
 * ferramenta), então o risco que essa guarda evitava — falar por cima do
 * humano — já estava fechado noutro lugar, por outro mecanismo, sem depender
 * desta checagem.
 *
 * O motivo da virada: decisão do Anderson (2026-09-18) de que o atendimento
 * passa a ser 100% humano — o atendente está SEMPRE respondendo pelo CRM, e
 * cada mensagem humana renova `bot_silenced_until` por uma janela curta
 * (`HUMAN_REPLY_SILENCE_MS`, em `messages/_handler.ts`). Numa conversa
 * ativa, essa janela fica quase sempre no futuro — e a guarda antiga
 * bloquearia o Operador o tempo inteiro, que é justamente a ÚNICA coisa que a
 * IA faz hoje (mover o lead pela etapa certa do funil). Medido em produção:
 * 12 de 13 execuções recentes do Operador saíam `pulado: handoff_humano`.
 *
 * Este arquivo agora prova o INVERSO do que provava antes: que o Operador
 * CONTINUA agindo (lê declaração, escreve promessa sem dono, teria chamado
 * ferramenta de CRM se tivesse uma configurada) tanto com `force_human` quanto
 * com `bot_silenced_until` no futuro — e que, ao mesmo tempo, ele não tem e
 * não pode ter `send_message` no toolset, então "organizar o CRM com humano
 * ativo" nunca se traduz em "falar com o cliente". Essa segunda parte é
 * garantida em `lib/agent-engine/edge/crm/mcp-tools.ts` (`BLOCKED_TOOL_IDS`) e
 * em `deveOmitirSendMessage` — não repetida aqui.
 *
 * `inbound-turn.ts` e `followup-turn.ts` MANTÊM a guarda de `isLeadInHandoff`
 * sem mudança nenhuma: eles TÊM `send_message`, então falar por cima de quem
 * assumiu continua sendo exatamente o risco que a guarda existe para evitar.
 * Este arquivo cobre só o Operador.
 *
 * ## Por que Postgres real
 *
 * A prova precisa de `force_human`/`bot_silenced_until` de verdade e do
 * handler de verdade rodando por cima — não da função pura isolada — porque o
 * que se quer provar é que o CAMINHO DE EXECUÇÃO não lê mais esse estado para
 * decidir se roda.
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOperatorTurnHandler } from "@/lib/agent-engine/agent/operator-turn";
import type { InboundTurnDeps } from "@/lib/agent-engine/agent/inbound-turn";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import type { Logger } from "@/lib/agent-engine/obs/logger";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

// Fixtures PRÓPRIAS, não as do `seedGov`: este arquivo escreve em `force_human` e
// `bot_silenced_until`, e o container é compartilhado entre arquivos de invariante
// (`fileParallelism: false`). Mexer no contato de outro teste faria a suíte falhar
// por ordem de execução — o tipo de vermelho que ninguém consegue ler.
const ORG = "0be7a70b-0000-4000-8000-000000000001";
const CONTACT = "0be7a70b-0000-4000-8000-000000000002";
const SESSION = "0be7a70b-0000-4000-8000-000000000003";
const CONV = "0be7a70b-0000-4000-8000-000000000004";
const AGENT = "0be7a70b-0000-4000-8000-000000000005";
const VERSION = "0be7a70b-0000-4000-8000-000000000006";
const PIPELINE = "0be7a70b-0000-4000-8000-000000000007";
const STAGE = "0be7a70b-0000-4000-8000-000000000008";
const LEAD = "0be7a70b-0000-4000-8000-000000000009";
/** Segunda conversa do MESMO contato — canal próprio, mesma regra da suíte antiga. */
const CONV_B = "0be7a70b-0000-4000-8000-00000000000a";
const SESSION_B = "0be7a70b-0000-4000-8000-00000000000b";
/** O job do turno do Conversador — o MESMO valor que `job().payload.origin_job_id`. */
const ORIGIN_JOB = "0be7a70b-0000-4000-8000-0000000000bb";

/** A declaração que o Conversador deixou: uma promessa, com prazo. */
const DECLARACAO = {
  intencoes: [{ o_que: "quer remarcar a consulta", evidencia: "pode ser na terça?" }],
  promessas: [{ o_que: "vou confirmar o horário e te retorno", prazo: "2026-08-11" }],
  nada_a_declarar: false,
};

function fakeLogger(): Logger & { entries: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> } {
  const entries: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
  return {
    entries,
    info: (msg, fields) => entries.push({ level: "info", msg, ...(fields !== undefined ? { fields } : {}) }),
    warn: (msg, fields) => entries.push({ level: "warn", msg, ...(fields !== undefined ? { fields } : {}) }),
    error: (msg, fields) => entries.push({ level: "error", msg, ...(fields !== undefined ? { fields } : {}) }),
  };
}

function fakeDeps(log: Logger): InboundTurnDeps {
  return {
    crmCfg: { supabase: createClient("http://127.0.0.1", "test-key") },
    llmCfg: {},
    knobs: {
      historyLimit: 20,
      maxContextTokens: 1_000,
      notesIndexMaxTokens: 500,
      maxSteps: 6,
      queuedRetryDelayMs: 1_000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 4,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 6,
        noProgressWarn: 2,
        noProgressBlock: 4,
      },
    },
    log,
  };
}

function job(): JobRow {
  return {
    id: "0be7a70b-0000-4000-8000-0000000000aa",
    organization_id: ORG,
    contact_id: CONTACT,
    kind: "operator_turn",
    source_event_id: null,
    payload: {
      conversation_id: CONV,
      origin_job_id: ORIGIN_JOB,
      agent_id: AGENT,
    },
    status: "running",
    priority: 100,
    run_after: new Date(),
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    locked_by: "test-worker",
    locked_at: new Date(),
    created_at: new Date(),
  };
}

async function avisosAbertos(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from agent_inbox_items
      where organization_id = $1 and kind = 'promise_unfulfilled'`,
    [ORG],
  );
  return Number(rows[0]?.n ?? "0");
}

async function rodarOperador(conversa = CONV): Promise<ReturnType<typeof fakeLogger>> {
  const log = fakeLogger();
  const j = job();
  j.payload = { ...(j.payload as Record<string, unknown>), conversation_id: conversa };
  await createOperatorTurnHandler(fakeDeps(log))(j, pool, { workerId: "test-worker" });
  return log;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-operador-handoff', 'Org Handoff LTDA', 'Org Handoff')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'operador-handoff-session', 'WORKING', '\\x00'::bytea)
     on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead do Handoff', '+5511900000912') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente do handoff', 'system') on conflict (id) do nothing`,
    [AGENT, ORG],
  );
  // `operator_enabled = true` e `operator_tool_ids` no default (vazio): o papel
  // roda e não chama modelo nenhum — é o caminho em que o aviso de promessa é o
  // único efeito, o que torna a asserção sobre ele limpa e sem LLM.
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model,
        channel_session_id, status, operator_enabled)
     values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published', true)
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);
  // O JOB QUE ORIGINOU O TURNO — e ele vem ANTES do checkpoint por causa da FK
  // `lead_checkpoints.job_id references job_queue(id)`.
  await pool.query(
    `insert into job_queue (id, organization_id, contact_id, kind, payload)
     values ($1, $2, $3, 'inbound_turn', '{}') on conflict (id) do nothing`,
    [ORIGIN_JOB, ORG, CONTACT],
  );
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, job_id, rolling_summary, declaracao)
     values ($1, $2, $3, 'quer remarcar', $4::jsonb)`,
    [ORG, CONTACT, ORIGIN_JOB, JSON.stringify(DECLARACAO)],
  );

  // Funil + etapa + negócio ABERTO: sem um lead aberto para o contato, a linha de
  // timeline não tem onde pousar.
  await pool.query(
    `insert into crm_pipelines (id, organization_id, name, slug)
     values ($1, $2, 'Funil do handoff', 'funil-do-handoff') on conflict (id) do nothing`,
    [PIPELINE, ORG],
  );
  await pool.query(
    `insert into crm_stages (id, organization_id, pipeline_id, name, slug, position)
     values ($1, $2, $3, 'Novo', 'novo', 1) on conflict (id) do nothing`,
    [STAGE, ORG, PIPELINE],
  );
  await pool.query(
    `insert into crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status)
     values ($1, $2, $3, $4, $5, 'Negócio do handoff', 'open') on conflict (id) do nothing`,
    [LEAD, ORG, PIPELINE, STAGE, CONTACT],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'operador-handoff-session-b', 'WORKING', '\\x00'::bytea)
     on conflict (id) do nothing`,
    [SESSION_B, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV_B, ORG, CONTACT, SESSION_B],
  );

  // Controle positivo do pool: no banco errado as contagens viriam zeradas e
  // pareceriam medição.
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from lead_checkpoints where organization_id = $1 and declaracao is not null`,
    [ORG],
  );
  if (rows[0]?.n !== "1") throw new Error(`fixture não chegou ao banco da porta ${PORT}`);
});

beforeEach(async () => {
  await pool.query(`delete from agent_inbox_items where organization_id = $1`, [ORG]);
  await pool.query(`delete from event_log where organization_id = $1`, [ORG]);
  await pool.query(`delete from crm_lead_activities where organization_id = $1`, [ORG]);
  await pool.query(`update contacts set force_human = false where id = $1`, [CONTACT]);
  await pool.query(`update conversations set bot_silenced_until = null where id = $1`, [CONV]);
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("o Operador continua agindo mesmo com um humano na conversa", () => {
  it("com force_human no contato, ainda assim roda e escreve a promessa sem dono", async () => {
    await pool.query(`update contacts set force_human = true where id = $1`, [CONTACT]);

    const log = await rodarOperador();

    // O sinal antigo (`porque: 'handoff_humano'`) não existe mais — o papel não
    // pula por isso. Ele roda, e como não há `operator_tool_ids` configurado
    // nesta fixture, o efeito observável é a promessa sem dono (mesmo caminho
    // que rodaria sem handoff nenhum).
    expect(await avisosAbertos(), "force_human passou a bloquear o Operador de novo").toBe(1);
    expect(log.entries.some((e) => e.msg.includes("operador rodou")), "o papel não chegou a rodar").toBe(true);
    expect(log.entries.some((e) => e.fields?.porque === "handoff_humano")).toBe(false);
  });

  it("com a conversa silenciada (bot_silenced_until no futuro), também roda normalmente", async () => {
    // O outro braço do antigo `or` de isLeadInHandoff — cobrir só force_human
    // deixaria passar uma regressão que reintroduzisse a guarda usando só a
    // outra fonte.
    await pool.query(
      `update conversations set bot_silenced_until = now() + interval '1 hour' where id = $1`,
      [CONV],
    );

    const log = await rodarOperador();

    expect(await avisosAbertos()).toBe(1);
    expect(log.entries.some((e) => e.msg.includes("operador rodou"))).toBe(true);
  });

  it("silêncio VENCIDO nunca foi problema, e continua não sendo", async () => {
    await pool.query(
      `update conversations set bot_silenced_until = now() - interval '1 hour' where id = $1`,
      [CONV],
    );

    await rodarOperador();

    expect(await avisosAbertos()).toBe(1);
  });
});

/**
 * O DESFECHO DO TURNO EXISTE FORA DO STDOUT — e o aviso só afirma o que apurou.
 */
describe("o desfecho do Operador vira registro mesmo com humano na conversa", () => {
  async function eventosDoOperador(): Promise<Array<Record<string, unknown>>> {
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from event_log
        where organization_id = $1 and event_type = 'agent.operator_turn'
        order by created_at`,
      [ORG],
    );
    return rows.map((r) => r.payload);
  }

  it("toda execução deixa uma linha em event_log — inclusive com force_human", async () => {
    await pool.query(`update contacts set force_human = true where id = $1`, [CONTACT]);
    await rodarOperador();
    const eventos = await eventosDoOperador();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.desfecho).toBe("agiu");
  });

  it("a promessa sem responsável aparece na TIMELINE do negócio, não só no banco", async () => {
    await rodarOperador();
    const { rows } = await pool.query<{ type: string; payload: Record<string, unknown> }>(
      `select a.type, a.payload from crm_lead_activities a
        where a.organization_id = $1 and a.type = 'promise_unowned'`,
      [ORG],
    );
    expect(rows, "a linha não chegou à timeline — o dono do negócio não vê").toHaveLength(1);
    expect(rows[0]!.payload.porque).toBe("operador_sem_ferramentas");
  });

  it("o MESMO problema aberto não abre um segundo aviso", async () => {
    await rodarOperador();
    await rodarOperador();
    expect(await avisosAbertos()).toBe(1);
  });

  it("mas OUTRA conversa abre o seu — a chave não é cega", async () => {
    await rodarOperador(CONV);
    await rodarOperador(CONV_B);
    expect(await avisosAbertos()).toBe(2);
  });

  it("o aviso NÃO afirma cumprimento — nem no título, nem no corpo", async () => {
    await rodarOperador();
    const { rows } = await pool.query<{ title: string; body: string }>(
      `select title, body from agent_inbox_items
        where organization_id = $1 and kind = 'promise_unfulfilled'`,
      [ORG],
    );
    expect(rows).toHaveLength(1);
    const texto = `${rows[0]!.title} ${rows[0]!.body}`.toLowerCase();
    for (const proibido of ["cumpriu", "cumprida", "cumprimento"]) {
      expect(texto, `o aviso voltou a afirmar cumprimento ("${proibido}")`).not.toContain(proibido);
    }
    expect(texto).toContain("responsável");
  });

  it("com um humano na conversa, registra o desfecho e ABRE o aviso do mesmo jeito", async () => {
    // A exceção antiga ("Central é para o que ninguém está olhando, e quem
    // assumiu está olhando") não vale mais: o Operador roda igual, sem saber se
    // é o mesmo humano que vai notar a promessa sem dono. Melhor um aviso
    // redundante do que uma promessa que ninguém assume.
    await pool.query(`update contacts set force_human = true where id = $1`, [CONTACT]);
    await rodarOperador();
    expect(await avisosAbertos()).toBe(1);
    expect(await eventosDoOperador()).toHaveLength(1);
  });
});
