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

/** Um par rótulo/valor da ficha — omitido inteiro quando o valor é vazio, não mostra "—". */
function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{children}</span>
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
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{produto.nome}</span>
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
