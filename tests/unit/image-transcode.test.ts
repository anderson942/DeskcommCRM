import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

/**
 * Imagem num formato que o WhatsApp não entende (AVIF/HEIC/HEIF) → JPEG.
 *
 * ─── O defeito, medido em produção (2026-09-16) ─────────────────────────────
 *
 * Time arrastou fotos de produto do site (CDN serve AVIF) pro composer. O
 * upload passou por TODA validação (`validateOutboundMedia` só olha o
 * prefixo `image/`), o WAHA aceitou a entrega — e a mensagem ficou travada em
 * `status: sent, ack: 1` pra sempre, sem nenhum `error_code`. O WhatsApp
 * simplesmente não sabe renderizar AVIF como imagem, e não avisa.
 *
 * O que estes casos prendem: que a conversão só act quando precisa (não
 * reencoda um JPEG que já serve), que falhar devolve o ORIGINAL — um anexo
 * que talvez não renderize é melhor que um upload que morre antes de tentar
 * —, e que o mime devolvido é sempre o do arquivo GUARDADO.
 */
import {
  precisaTranscodificarImagem,
  transcodificarImagemExterna,
} from "@/lib/messaging/media/image-transcode";

describe("quando precisa converter", () => {
  it("avif, heic e heif precisam — é o que a CDN da loja e o iPhone produzem", () => {
    expect(precisaTranscodificarImagem("image/avif")).toBe(true);
    expect(precisaTranscodificarImagem("image/heic")).toBe(true);
    expect(precisaTranscodificarImagem("image/heif;charset=binary")).toBe(true);
  });

  it("jpeg, png e webp NÃO precisam — o WhatsApp já aceita", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(precisaTranscodificarImagem(m)).toBe(false);
    }
  });

  it("áudio e documento não são assunto daqui", () => {
    expect(precisaTranscodificarImagem("audio/ogg")).toBe(false);
    expect(precisaTranscodificarImagem("application/pdf")).toBe(false);
  });
});

describe("a conversão", () => {
  it("avif de verdade vira jpeg de verdade, com o conteúdo preservado", async () => {
    // Gera o AVIF com o MESMO sharp que faz a conversão — não é um dublê, é
    // o round-trip real que a CDN da loja força todo drag a passar.
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const avif = await sharp(png).avif().toBuffer();

    const r = await transcodificarImagemExterna({ buffer: avif, mime: "image/avif" });

    expect(r.convertido).toBe(true);
    expect(r.mime).toBe("image/jpeg");
    const meta = await sharp(r.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });

  it("NÃO reencoda quando não precisa — conversão à toa é custo puro", async () => {
    const original = Buffer.from("jpeg-bytes-falsos");
    const r = await transcodificarImagemExterna({ buffer: original, mime: "image/jpeg" });
    expect(r.convertido).toBe(false);
    expect(r.buffer).toBe(original);
    expect(r.mime).toBe("image/jpeg");
  });

  it("buffer que não é imagem de verdade falha e devolve o ORIGINAL, não erro", async () => {
    const lixo = Buffer.from("isto não é um avif");
    const r = await transcodificarImagemExterna({ buffer: lixo, mime: "image/avif" });
    expect(r.convertido).toBe(false);
    expect(r.buffer).toBe(lixo);
    expect(r.mime).toBe("image/avif");
  });
});

describe("o elo que some sem barulho", () => {
  it("a rota de upload converte ANTES de guardar", () => {
    const fonte = readFileSync("app/api/v1/conversations/[id]/media/route.ts", "utf8");
    expect(fonte).toContain("transcodificarImagemExterna");
  });

  it("devolve o mime do arquivo GUARDADO, não o que chegou", () => {
    // Devolver o original mandaria o canal buscar um `avif` que já não existe
    // no bucket com aquele mime — o mesmo defeito, um passo adiante.
    const fonte = readFileSync("app/api/v1/conversations/[id]/media/route.ts", "utf8");
    expect(fonte).toMatch(/media_mime:\s*mimeFinal/);
  });
});
