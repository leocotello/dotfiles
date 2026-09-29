# Marsh Energy Upstream Team — vídeo promocional (ANP ago/2026)

Motion graphics de 30 s (1920×1080, 30 fps, H.264) baseado no Boletim Mensal da Produção de Petróleo e Gás Natural da ANP.

- `marsh-energy-upstream-ago2026.mp4`: vídeo final
- `video.html`: animação (abra no navegador para pré-visualizar em loop)
- `render.mjs`: renderiza quadro a quadro com Playwright/Chromium e codifica com ffmpeg

```sh
NODE_PATH=$(npm root -g) FFMPEG=/caminho/do/ffmpeg node render.mjs          # gera o MP4
NODE_PATH=$(npm root -g) node render.mjs --stills                          # quadros-chave em PNG
```

## Roteiro

| Tempo | Cena | Conteúdo |
|---|---|---|
| 0–3,3 s | Abertura | O Brasil atinge um novo patamar em óleo e gás |
| 3,3–8,3 s | Produção total | 6,00 mi boe/d, marca histórica; +2,6% vs. jul/26, +18,0% vs. ago/25 |
| 8,3–12,4 s | Petróleo e gás | 4,61 mi bbl/d (+18,4% a/a); 220,5 mi m³/d (+16,7% a/a) |
| 12,4–16,6 s | Pré-sal | 82,6% da produção; 4,96 mi boe/d; 79,4% → 82,6% em 12 meses |
| 16,6–21 s | Campos e operadoras | Búzios, Mero, FPSO Almirante Tamandaré; 87% Petrobras; demais operadoras 9,9% → 12,7% |
| 21–24,5 s | Complexidade | Operacional · Contratual · Exposição a riscos |
| 24,5–27 s | Marsh | Conhecimento técnico · Visão de mercado · Soluções especializadas |
| 27–30 s | Assinatura | "Em uma indústria que segue avançando, contar com o parceiro certo faz toda a diferença." Marsh. Energy Upstream Team |

## Dados e fontes

- **Totais de agosto/2026 (preliminares, ANP, divulgados em 25/09/2026):** 6,00 mi boe/d (+2,61% m/m); petróleo 4,613 mi bbl/d; gás 220,5 mi m³/d; pré-sal 4,958 mi boe/d = 82,64%.
- **Agosto/2025 (consolidado ANP), base das variações anuais:** 5,084 mi boe/d; petróleo 3,896 mi bbl/d; gás 188,9 mi m³/d; pré-sal 79,4%; Petrobras operadora de 90,07%.
- **Campos, instalações e operadoras: julho/2026 (último boletim consolidado):** Búzios 1,113 mi bbl/d; Mero 49,14 mi m³/d; FPSO Almirante Tamandaré 263.178 bbl/d; Petrobras operadora de 87,27%.
  O detalhamento por campo e operadora de agosto sai no boletim consolidado; atualize `video.html` e rode `render.mjs` quando ele for publicado.

Fontes Inter e IBM Plex Mono (SIL OFL) estão incluídas em `fonts/`.
