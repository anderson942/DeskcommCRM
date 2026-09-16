/**
 * Imagem num formato que o WhatsApp não entende → JPEG.
 *
 * ─── O defeito, medido em produção (2026-09-16) ─────────────────────────────
 *
 * Time arrastou fotos de produto do site (outlet360.com.br) pro composer. O
 * CRM subiu, mandou pro WAHA, o WAHA entregou pro WhatsApp — e a mensagem
 * ficou travada em `status: sent, ack: 1` pra sempre. Nunca vira `delivered`,
 * nunca aparece pro cliente. Nenhum `error_code` — o WhatsApp aceita a
 * entrega e simplesmente não sabe renderizar o arquivo como imagem.
 *
 * `media_mime` das mensagens travadas: `image/avif`. O site serve as fotos
 * de produto nesse formato (comum em CDN moderna — menor, mais rápido) — mas
 * o WhatsApp só reconhece imagem enviada como JPEG/PNG/WEBP. `image/avif`
 * passa por TODAS as validações do pipeline (`validateOutboundMedia` só olha
 * o prefixo `image/`), e por isso o defeito não aparece em teste nenhum até
 * chegar no aparelho de verdade — o mesmo formato de bug do `webm` na nota de
 * voz (`voice-transcode.ts`), só que sem o `131053` avisando; aqui é silêncio.
 *
 * ─── Por que converter no UPLOAD, não no envio ──────────────────────────────
 *
 * Mesma razão do áudio: converter uma vez ao guardar faz TODO canal futuro
 * receber um arquivo que já funciona, e o mesmo anexo pode ser reencaminhado
 * sem repetir o trabalho.
 *
 * ─── Por que sharp, não ffmpeg ──────────────────────────────────────────────
 *
 * O `ffmpeg` já vive na imagem (derivação de vídeo), mas decodificar AVIF
 * depende de qual codec AV1 o build do Alpine linkou — não é garantia. O
 * `sharp` (libvips) traz decode de AVIF embutido no binário pré-compilado,
 * sem depender do que o `apk add ffmpeg` trouxe junto.
 */
import sharp from "sharp";

/** O que o WhatsApp entende como imagem — o resto vira JPEG. */
const MIMES_PROBLEMATICOS = new Set(["image/avif", "image/heic", "image/heif"]);

export function precisaTranscodificarImagem(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIMES_PROBLEMATICOS.has(base);
}

export interface TranscodificacaoImagem {
  buffer: Buffer;
  mime: string;
  /** `false` = devolvido intacto, porque não precisava (ou não deu). */
  convertido: boolean;
}

/**
 * AVIF/HEIC/HEIF → JPEG. Falha devolve o original INTACTO, não erro: um
 * anexo que talvez não renderize é melhor que um envio que morre antes de
 * tentar — mesma doutrina do áudio.
 */
export async function transcodificarImagemExterna(input: {
  buffer: Buffer;
  mime: string;
}): Promise<TranscodificacaoImagem> {
  if (!precisaTranscodificarImagem(input.mime)) {
    return { buffer: input.buffer, mime: input.mime, convertido: false };
  }
  try {
    const buffer = await sharp(input.buffer).rotate().jpeg({ quality: 90 }).toBuffer();
    if (buffer.length === 0) return { buffer: input.buffer, mime: input.mime, convertido: false };
    return { buffer, mime: "image/jpeg", convertido: true };
  } catch {
    return { buffer: input.buffer, mime: input.mime, convertido: false };
  }
}
