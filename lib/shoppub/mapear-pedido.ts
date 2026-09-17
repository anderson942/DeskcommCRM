/**
 * Um pedido da Shoppub → a linha que `orders` espera.
 *
 * `contact_id` vem de FORA (não dá pra resolver aqui): quem casa telefone
 * com contato é o CRON, numa consulta em LOTE por rodada — resolver um a um
 * dentro do mapeamento faria a função parar de ser pura e viraria uma
 * consulta ao banco por pedido, o mesmo N+1 que o catálogo de produtos evitou
 * pra estoque.
 */
import type { ShoppubPedido } from "./api-client";

function paraCentavos(v: string | number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function mapearPedido(p: ShoppubPedido, orgId: string, contactId: string | null) {
  return {
    organization_id: orgId,
    external_id: String(p.id),
    external_provider: "shoppub",
    contact_id: contactId,
    // `status`/`status_resumido` não têm tabela de valores documentada.
    // `data_pagamento` presente é o único sinal CONFIRMADO contra pedido
    // real (2026-09-17): casa sempre com status=1. O código bruto fica em
    // `payload`, pra quem precisar investigar sem perder o dado original.
    status: p.data_pagamento ? "paid" : "pending",
    total_cents: paraCentavos(p.valor_total),
    currency: "BRL",
    payload: { status_raw: p.status, status_resumido_raw: p.status_resumido },
    ordered_at: p.data,
  };
}
