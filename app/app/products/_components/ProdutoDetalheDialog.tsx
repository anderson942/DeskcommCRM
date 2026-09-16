"use client";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { formatCents } from "@/lib/money";
import type { Produto } from "@/lib/schemas/produtos";

/** Rótulo de exibição por origem — o valor cru ("shoppub") não é o que o dono da loja lê. */
const ORIGEM_ROTULO: Record<string, string> = {
  manual: "Cadastro manual",
  planilha: "Planilha importada",
  nuvemshop: "Nuvemshop",
  tiny: "Tiny",
  shoppub: "Shoppub",
};

interface Props {
  produto: Produto | null;
  onClose: () => void;
}

/**
 * Rótulo em cima, valor embaixo — não lado a lado.
 *
 * ⚠️ A versão anterior era `flex justify-between` com rótulo e valor como
 * irmãos: um item flex, sem `min-w-0`, não encolhe abaixo do tamanho do
 * próprio conteúdo — é a armadilha clássica do Tailwind/flexbox. Medido em
 * produção (2026-09-16): nome de produto longo ("Calça VersatiOld
 * Alfaiataria Premium Slim Cinza 38 40 42 44 46 48 50 - 50", comum na
 * Shoppub, que concatena TODAS as variações de tamanho no nome) e uma linha
 * de categoria com 8+ nomes juntos vazavam pra fora da caixa do dialog em
 * vez de quebrar linha. Empilhado, cada valor é um bloco comum — quebra
 * sozinho, sem precisar calcular `min-w` nenhum.
 */
function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5 text-sm">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-medium break-words">{children}</p>
    </div>
  );
}

export function ProdutoDetalheDialog({ produto, onClose }: Props) {
  const t = useT();
  if (!produto) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 break-words pr-6">
            <span>{produto.nome}</span>
            {!produto.ativo && <Badge variant="secondary">{t("Inativo")}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {produto.imagem_url ? (
          <img
            src={produto.imagem_url}
            alt={produto.nome}
            className="max-h-48 w-full rounded-md border object-contain"
          />
        ) : null}

        <div className="divide-y">
          <Linha rotulo={t("Código")}>{produto.codigo}</Linha>
          {produto.marca ? <Linha rotulo={t("Marca")}>{produto.marca}</Linha> : null}
          {produto.categoria ? <Linha rotulo={t("Categoria")}>{produto.categoria}</Linha> : null}
          <Linha rotulo={t("Preço")}>
            {produto.preco_original_cents !== null ? (
              <>
                <span className="mr-1.5 text-muted-foreground line-through">
                  {formatCents(produto.preco_original_cents, produto.moeda)}
                </span>
                {formatCents(produto.preco_cents, produto.moeda)}
              </>
            ) : (
              formatCents(produto.preco_cents, produto.moeda)
            )}
          </Linha>
          <Linha rotulo={t("Estoque")}>
            {produto.controla_estoque
              ? `${produto.quantidade} ${t("em estoque")}`
              : t("Sem controle de estoque")}
          </Linha>
          <Linha rotulo={t("Origem")}>{ORIGEM_ROTULO[produto.origem] ?? produto.origem}</Linha>
        </div>

        {produto.descricao ? (
          <p className="text-sm text-muted-foreground">{produto.descricao}</p>
        ) : null}

        {produto.url_produto ? (
          <a
            href={produto.url_produto}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-primary underline underline-offset-2"
          >
            {t("Ver na loja")} ↗
          </a>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
