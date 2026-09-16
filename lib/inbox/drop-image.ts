/**
 * Imagem arrastada de OUTRA ABA do navegador (o produto no site, o catálogo,
 * uma pesquisa de imagens) — padrão WhatsApp Web/Gmail: arrastar a foto para
 * dentro da conversa anexa, não abre a imagem numa aba nova.
 *
 * Duas formas o browser entrega o que foi arrastado:
 *  1. Já como `File` em `dataTransfer.files`/`.items` — Chrome materializa
 *     isso pra uma <img> arrastada entre abas/janelas na MAIORIA dos casos.
 *     `imagemDoClipboard` já sabe ler isso (o `DragEvent.dataTransfer` é o
 *     mesmo tipo `DataTransfer` do clipboard) — reaproveitado, não duplicado.
 *  2. Só como URL, em `text/uri-list` (RFC 2483: uma URI por linha, `#` é
 *     comentário) — quando o CDN de origem não confirma a materialização, ou
 *     em browsers que não fazem o passo 1. É o caso que abre aba nova hoje:
 *     sem handler nenhum, o browser trata o drop como navegação para a URL.
 */

export function urlDaImagemArrastada(dados: DataTransfer | null): string | null {
  if (!dados) return null;

  const uriList = dados.getData("text/uri-list");
  const daLista = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (daLista) return daLista;

  // Fallback observado em alguns browsers: só `text/plain` vem preenchido.
  const plano = dados.getData("text/plain").trim();
  if (/^https?:\/\//i.test(plano)) return plano;

  return null;
}

/** Nome pro arquivo baixado via URL — usa o nome real do arquivo quando dá. */
export function nomeDaImagemArrastada(url: string, mime: string, carimbo: Date): string {
  try {
    const ultimoSegmento = new URL(url).pathname.split("/").pop();
    if (ultimoSegmento && /\.[a-z0-9]{2,4}$/i.test(ultimoSegmento)) {
      return decodeURIComponent(ultimoSegmento);
    }
  } catch {
    // URL não parseável (não deveria chegar aqui — já passou pelo backend) → nome genérico abaixo.
  }
  const ext = mime.split("/")[1]?.split(";")[0]?.trim() || "jpg";
  const iso = carimbo.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `imagem-arrastada-${iso}.${ext}`;
}
