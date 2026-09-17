"use client";

import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agruparProdutos, rotuloDaVariacao, type GrupoDeProdutos } from "@/lib/catalogo/agrupamento";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { formatCents } from "@/lib/money";
import { precoParaCentavos, type Produto } from "@/lib/schemas/produtos";
import { ProdutoDetalheDialog } from "./_components/ProdutoDetalheDialog";

type FiltroEstoque = "todos" | "disponivel" | "esgotado";
type Tamanho = 10 | 25 | 50 | 100 | "tudo";
/** Tem que bater com `TAMANHOS_VALIDOS` de `app/api/v1/products/route.ts`. */
const TAMANHOS_VALIDOS = [10, 25, 50, 100] as const;

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

interface ResumoDaImportacao {
  total_linhas: number;
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}

interface Rascunho {
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  preco: string;
  custo: string;
  quantidade: string;
  controla_estoque: boolean;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  marca: "",
  categoria: "",
  preco: "",
  custo: "",
  quantidade: "0",
  controla_estoque: true,
};

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const preco_cents = precoParaCentavos(r.preco);
  if (preco_cents === null) return { erro: t("Preço inválido. Escreva assim: 5.499,00") };
  const custo_cents = r.custo.trim() === "" ? null : precoParaCentavos(r.custo);
  if (r.custo.trim() !== "" && custo_cents === null) return { erro: t("Custo inválido.") };

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    ...(r.marca.trim() ? { marca: r.marca.trim() } : {}),
    ...(r.categoria.trim() ? { categoria: r.categoria.trim() } : {}),
    preco_cents,
    custo_cents,
    controla_estoque: r.controla_estoque,
    quantidade: Number(r.quantidade) || 0,
  };
}

export function ProdutosClient({
  inicial,
  totalInicial,
  tamanhoInicial,
  podeEditar,
  textos,
}: {
  inicial: Produto[];
  totalInicial: number;
  tamanhoInicial: number;
  podeEditar: boolean;
  textos: Textos;
}) {
  const t = useT();
  const [buscaDigitada, setBuscaDigitada] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(1);
  const [tamanho, setTamanho] = React.useState<Tamanho>(tamanhoInicial as Tamanho);
  const [filtroEstoque, setFiltroEstoque] = React.useState<FiltroEstoque>("todos");
  // `inicial` vem FLAT do server component (`page.tsx`, sem mudar) — agrupa
  // uma vez aqui só pro primeiro render; toda busca seguinte já chega
  // agrupada da API (0271), sem precisar reagrupar no cliente.
  const [grupos, setGrupos] = React.useState<GrupoDeProdutos<Produto>[]>(() => agruparProdutos(inicial));
  const [gruposAbertos, setGruposAbertos] = React.useState<Set<string>>(() => new Set());
  const [total, setTotal] = React.useState(totalInicial);
  const [carregando, setCarregando] = React.useState(false);
  const [criando, setCriando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = React.useState(false);
  const [importando, setImportando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaImportacao | null>(null);
  const [detalhe, setDetalhe] = React.useState<Produto | null>(null);
  // O dropdown de sugestões reaproveita o MESMO `grupos` que a lista de
  // baixo já buscou — a busca inteligente (0270/0271) já devolve ranqueado
  // por relevância, então os 5 primeiros já são as melhores sugestões, sem
  // round-trip extra pro servidor.
  const [sugestoesAbertas, setSugestoesAbertas] = React.useState(false);

  function alternarGrupoAberto(chave: string) {
    setGruposAbertos((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }
  const arquivoRef = React.useRef<HTMLInputElement>(null);
  // Incrementar isto força o efeito de busca a rodar de novo com os MESMOS
  // filtros — é o que substitui o antigo `router.refresh()` (que só refazia
  // a busca quando ela morava no server component; agora mora aqui).
  const [versao, setVersao] = React.useState(0);
  const recarregarPaginaAtual = React.useCallback(() => setVersao((v) => v + 1), []);

  // Debounce da busca — 400ms sem digitar antes de virar requisição pro
  // servidor. Cada tecla vira um round-trip agora (a busca deixou de filtrar
  // em memória), então não debounçar afogaria a rota a cada letra.
  React.useEffect(() => {
    const timer = setTimeout(() => setBusca(buscaDigitada), 400);
    return () => clearTimeout(timer);
  }, [buscaDigitada]);

  // Qualquer filtro novo volta pra página 1 — senão a pessoa pode ficar
  // numa página 8 que não existe mais depois de estreitar o resultado.
  React.useEffect(() => {
    setPagina(1);
  }, [busca, tamanho, filtroEstoque]);

  React.useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    const params = new URLSearchParams();
    if (busca) params.set("busca", busca);
    params.set("pagina", String(pagina));
    params.set("tamanho", String(tamanho));
    if (filtroEstoque !== "todos") params.set("estoque", filtroEstoque);

    apiClient
      .get<ApiSuccess<GrupoDeProdutos<Produto>[]>>(`/api/v1/products?${params.toString()}`, {
        signal: controller.signal,
      })
      .then((res) => {
        setGrupos(res.data);
        setTotal((res.meta?.total as number | undefined) ?? res.data.length);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        showApiError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });

    return () => controller.abort();
  }, [busca, pagina, tamanho, filtroEstoque, versao]);

  const tamanhoNumerico = tamanho === "tudo" ? total || 1 : tamanho;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoNumerico));
  const inicioDaPagina = total === 0 ? 0 : (pagina - 1) * tamanhoNumerico + 1;
  const fimDaPagina = Math.min(total, pagina * tamanhoNumerico);

  async function salvar() {
    const corpo = doRascunho(rascunho, t);
    if ("erro" in corpo) {
      toast.error(corpo.erro as string);
      return;
    }
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/products", corpo);
      toast.success(t("Produto cadastrado"));
      setRascunho(VAZIO);
      setCriando(false);
      recarregarPaginaAtual();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResumo(null);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch("/api/v1/products/import", { method: "POST", body: form });
      const json = (await res.json()) as
        | { data: ResumoDaImportacao }
        | { error?: { message?: string } };
      if (!res.ok || !("data" in json)) {
        const msg = "error" in json ? json.error?.message : undefined;
        toast.error(msg ?? t("Não consegui ler essa planilha."));
        return;
      }
      // O resumo fica NA TELA, não num toast que some em 4 segundos: quem
      // importou 300 produtos precisa ler quais linhas foram recusadas e por quê.
      setResumo(json.data);
      recarregarPaginaAtual();
    } catch {
      toast.error(t("Não consegui enviar o arquivo."));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function alternarAtivo(p: Produto) {
    try {
      await apiClient.patch(`/api/v1/products/${p.id}`, { ativo: !p.ativo });
      toast.success(t(p.ativo ? "Produto desativado" : "Produto reativado"));
      recarregarPaginaAtual();
    } catch (e) {
      showApiError(e);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6" data-testid="tela-produtos">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{textos.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{textos.subtitulo}</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <input
            value={buscaDigitada}
            onChange={(e) => {
              setBuscaDigitada(e.target.value);
              setSugestoesAbertas(e.target.value.trim() !== "");
            }}
            onFocus={() => setSugestoesAbertas(buscaDigitada.trim() !== "")}
            // `onMouseDown` com `preventDefault`, não `onBlur` com timeout: o
            // blur do input dispararia ANTES do `onClick` da sugestão, e a
            // lista fecharia antes do clique registrar. Impedir o foco de sair
            // do input no mousedown deixa o clique na sugestão completar.
            onBlur={() => setSugestoesAbertas(false)}
            placeholder={t("Buscar por nome, código ou marca")}
            className="h-9 w-full rounded-md border px-3 text-sm"
            data-testid="busca-produto"
            role="combobox"
            aria-expanded={sugestoesAbertas}
            aria-autocomplete="list"
          />
          {sugestoesAbertas && busca.trim() !== "" && grupos.length > 0 ? (
            <ul
              className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md"
              data-testid="sugestoes-produto"
              role="listbox"
            >
              {grupos.slice(0, 5).map((g) => (
                <li key={g.chave}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      // Grupo de 1: abre o popup direto, igual sempre abriu.
                      // Sanfona de verdade: não tem "o" produto — abre o
                      // acordeão pra escolher a variação.
                      if (g.variacoes.length === 1) setDetalhe(g.variacoes[0]!);
                      else alternarGrupoAberto(g.chave);
                      setSugestoesAbertas(false);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    data-testid={`sugestao-${g.chave}`}
                  >
                    {g.titulo}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {podeEditar ? (
          <>
            <Button onClick={() => setCriando((v) => !v)} data-testid="novo-produto">
              {t(criando ? "Cancelar" : "Novo produto")}
            </Button>
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="arquivo-planilha"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
              }}
            />
            <Button
              variant="outline"
              disabled={importando}
              onClick={() => arquivoRef.current?.click()}
              data-testid="importar-planilha"
            >
              {t(importando ? "Importando…" : "Importar planilha")}
            </Button>
          </>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(
            [
              { valor: "todos", rotulo: t("Todos") },
              { valor: "disponivel", rotulo: t("Em estoque") },
              { valor: "esgotado", rotulo: t("Esgotado") },
            ] as const
          ).map(({ valor, rotulo }) => (
            <button
              key={valor}
              type="button"
              onClick={() => setFiltroEstoque(valor)}
              data-testid={`filtro-estoque-${valor}`}
              className={`rounded-sm px-2.5 py-1 text-xs ${
                filtroEstoque === valor
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <Select value={String(tamanho)} onValueChange={(v) => setTamanho((v === "tudo" ? "tudo" : Number(v)) as Tamanho)}>
          <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="tamanho-pagina">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAMANHOS_VALIDOS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} {t("por página")}
              </SelectItem>
            ))}
            <SelectItem value="tudo">{t("Tudo")}</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {total === 0
            ? t("Nenhum produto")
            : `${inicioDaPagina}–${fimDaPagina} ${t("de")} ${total}`}
        </span>
      </div>

      {podeEditar ? (
        // Rota de API que devolve o arquivo com `content-disposition:
        // attachment` — é download, não navegação de página, e `<Link>` do Next
        // faria navegação de cliente para algo que não é tela.
        <a
          href="/api/v1/products/import"
          download="modelo-catalogo.csv"
          className="mb-4 inline-block text-xs text-muted-foreground underline"
          data-testid="modelo-planilha"
        >
          {t("Baixar planilha modelo")}
        </a>
      ) : null}

      {resumo ? (
        <div className="mb-6 rounded-lg border p-4 text-sm" data-testid="resumo-importacao">
          <p className="font-medium">
            {resumo.criados} {t("novos")} · {resumo.atualizados} {t("atualizados")} ·{" "}
            {resumo.total_linhas} {t("linhas na planilha")}
          </p>
          {resumo.colunas_ignoradas.length > 0 ? (
            <p className="mt-2 text-muted-foreground">
              {t("Não usei estas colunas:")} {resumo.colunas_ignoradas.join(", ")}.
            </p>
          ) : null}
          {resumo.erros.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium">{t("Linhas que não entraram:")}</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {resumo.erros.slice(0, 20).map((e) => (
                  <li key={`${e.linha}-${e.motivo}`}>
                    {t("Linha")} {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
              {resumo.erros.length > 20 ? (
                <p className="mt-1 text-muted-foreground">
                  {t("…e mais")} {resumo.erros.length - 20}.
                </p>
              ) : null}
            </div>
          ) : null}
          <button className="mt-3 text-xs underline" onClick={() => setResumo(null)}>
            {t("Fechar")}
          </button>
        </div>
      ) : null}

      {criando && podeEditar ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-produto">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Código")}
              <input
                value={rascunho.codigo}
                onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-codigo"
              />
            </label>
            <label className="text-sm">
              {t("Nome")}
              <input
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-nome"
              />
            </label>
            <label className="text-sm">
              {t("Marca")}
              <input
                value={rascunho.marca}
                onChange={(e) => setRascunho({ ...rascunho, marca: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
            </label>
            <label className="text-sm">
              {t("Categoria")}
              <input
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
            </label>
            <label className="text-sm">
              {t("Preço de venda")}
              <input
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                placeholder="5.499,00"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-preco"
              />
            </label>
            <label className="text-sm">
              {t("Custo")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <input
                value={rascunho.custo}
                onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })}
                placeholder="4.100,00"
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("Serve para o atendente saber até onde pode negociar. Não aparece para o cliente.")}
              </span>
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.controla_estoque}
              onChange={(e) => setRascunho({ ...rascunho, controla_estoque: e.target.checked })}
              data-testid="produto-controla-estoque"
            />
            {t("Controlar estoque deste produto")}
          </label>
          {rascunho.controla_estoque ? (
            <label className="mt-2 block text-sm">
              {t("Quantidade")}
              <input
                value={rascunho.quantidade}
                onChange={(e) => setRascunho({ ...rascunho, quantidade: e.target.value })}
                className="mt-1 h-9 w-32 rounded-md border px-3"
              />
            </label>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Sem controle de estoque, este produto sempre aparece como disponível para o atendente — é o certo para item sob encomenda ou fracionado.",
              )}
            </p>
          )}

          <div className="mt-4">
            <Button onClick={salvar} disabled={salvando} data-testid="salvar-produto">
              {t(salvando ? "Salvando…" : "Salvar produto")}
            </Button>
          </div>
        </div>
      ) : null}

      {grupos.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" data-testid="produtos-vazio">
          <p className="font-medium">{carregando ? t("Carregando…") : textos.vazio}</p>
          {carregando ? null : <p className="mt-1 text-sm text-muted-foreground">{textos.vazioDica}</p>}
        </div>
      ) : (
        <ul
          className={`divide-y rounded-lg border ${carregando ? "opacity-60" : ""}`}
          data-testid="lista-produtos"
        >
          {grupos.map((g) =>
            g.variacoes.length === 1 ? (
              <ProdutoLinha
                key={g.chave}
                p={g.variacoes[0]!}
                podeEditar={podeEditar}
                t={t}
                onAbrirDetalhe={setDetalhe}
                onAlternarAtivo={(p) => void alternarAtivo(p)}
              />
            ) : (
              // Sanfona de verdade: título limpo fechado por padrão — clicar
              // expande as variações de tamanho, cada uma abrindo o MESMO
              // popup de detalhe que uma linha solta já abre.
              <li key={g.chave} data-testid={`grupo-${g.chave}`}>
                <button
                  type="button"
                  onClick={() => alternarGrupoAberto(g.chave)}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                  data-testid={`abrir-grupo-${g.chave}`}
                  aria-expanded={gruposAbertos.has(g.chave)}
                >
                  <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden="true">
                    {gruposAbertos.has(g.chave) ? "−" : "+"}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate font-medium ${g.ativo ? "" : "text-muted-foreground line-through"}`}
                  >
                    {g.titulo}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.variacoes.length} {t("variações")}
                  </span>
                </button>
                {gruposAbertos.has(g.chave) ? (
                  <ul className="divide-y border-t bg-muted/40" data-testid={`variacoes-${g.chave}`}>
                    {g.variacoes.map((v) => (
                      <ProdutoLinha
                        key={v.id}
                        p={v}
                        rotulo={rotuloDaVariacao(v, g.titulo)}
                        indentado
                        podeEditar={podeEditar}
                        t={t}
                        onAbrirDetalhe={setDetalhe}
                        onAlternarAtivo={(p) => void alternarAtivo(p)}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}

      {tamanho !== "tudo" && totalPaginas > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            data-testid="pagina-anterior"
          >
            {t("Anterior")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("Página")} {pagina} {t("de")} {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            data-testid="pagina-proxima"
          >
            {t("Próxima")}
          </Button>
        </div>
      ) : null}

      <ProdutoDetalheDialog produto={detalhe} onClose={() => setDetalhe(null)} />
    </div>
  );
}

/**
 * Uma linha de produto — reaproveitada tanto pra um grupo de 1 (sem sanfona,
 * mesmo visual de sempre) quanto pra cada variação dentro de um acordeão
 * aberto (`rotulo`/`indentado`). `data-testid` continua `produto-${codigo}`/
 * `abrir-detalhe-${codigo}` nos dois casos — é o que faz "clicar na variação
 * abre o MESMO popup" ser literalmente o mesmo código, não uma cópia dele.
 */
function ProdutoLinha({
  p,
  rotulo,
  indentado,
  podeEditar,
  t,
  onAbrirDetalhe,
  onAlternarAtivo,
}: {
  p: Produto;
  rotulo?: string;
  indentado?: boolean;
  podeEditar: boolean;
  t: (s: string) => string;
  onAbrirDetalhe: (p: Produto) => void;
  onAlternarAtivo: (p: Produto) => void;
}) {
  return (
    <li
      className={`flex items-center gap-4 p-3 ${indentado ? "bg-muted/40 pl-8" : ""}`}
      data-testid={`produto-${p.codigo}`}
    >
      <button
        type="button"
        onClick={() => onAbrirDetalhe(p)}
        className="min-w-0 flex-1 text-left"
        data-testid={`abrir-detalhe-${p.codigo}`}
      >
        <p className={`truncate font-medium hover:underline ${p.ativo ? "" : "text-muted-foreground line-through"}`}>
          {rotulo ?? p.nome}
        </p>
        <p className="text-xs text-muted-foreground">
          {p.codigo}
          {p.marca ? ` · ${p.marca}` : ""}
          {p.controla_estoque
            ? ` · ${p.quantidade} ${t("em estoque")}`
            : ` · ${t("sem controle de estoque")}`}
        </p>
      </button>
      <span className="shrink-0 text-right tabular-nums">
        {p.preco_original_cents !== null ? (
          <span className="mr-1.5 text-muted-foreground line-through" data-testid={`preco-de-${p.codigo}`}>
            {formatCents(p.preco_original_cents, p.moeda)}
          </span>
        ) : null}
        <span className="font-medium" data-testid={`preco-por-${p.codigo}`}>
          {formatCents(p.preco_cents, p.moeda)}
        </span>
      </span>
      {podeEditar ? (
        <Button variant="ghost" size="sm" onClick={() => onAlternarAtivo(p)} data-testid={`alternar-${p.codigo}`}>
          {t(p.ativo ? "Desativar" : "Reativar")}
        </Button>
      ) : null}
    </li>
  );
}
