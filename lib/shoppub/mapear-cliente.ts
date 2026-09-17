/**
 * Um cliente da Shoppub → a linha que `commerce_customers` espera.
 *
 * Compartilhado entre o webhook (quando existir um evento de cliente) e o
 * cron `shoppub-customer-sync` — mesma regra num lugar só.
 */
import { normalizePhoneBR } from "@/lib/webhooks/inbound";
import type { ShoppubCliente } from "./api-client";

/** `"412.27"` (string) ou `412.27` (number) → 41227 (centavos). `null`/vazio → null. */
function paraCentavos(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Celular primeiro, telefone fixo como fallback — é o celular que tem
 * WhatsApp. `normalizePhoneBR` (mesmo normalizador da importação de CSV e
 * do inbound de captação) resolve o formato livre da Shoppub
 * ("(62) 99973-5261") pro E.164 que `contacts.phone_number` já usa.
 */
function resolverTelefone(c: ShoppubCliente): string | null {
  return normalizePhoneBR(c.celular) ?? normalizePhoneBR(c.telefone1);
}

export function mapearCliente(c: ShoppubCliente, orgId: string) {
  return {
    organization_id: orgId,
    origem: "shoppub",
    external_id: String(c.id),
    telefone_e164: resolverTelefone(c),
    nome: c.nome || null,
    email: c.email || null,
    total_gasto_cents: paraCentavos(c.total_gasto),
    quantidade_pedidos: c.quantidade_pedidos ?? null,
    quantidade_pedidos_pagos: c.quantidade_pedidos_pagos ?? null,
    ticket_medio_cents: paraCentavos(c.ticket_medio),
    data_ultimo_pedido: c.data_ultimo_pedido || null,
    bloqueado: c.bloqueado ?? false,
  };
}
