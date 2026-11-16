# Laboratório de estratégias — cor e branco

As duas estratégias abaixo são **hipóteses estatísticas retrospectivas**, não recomendações de aposta, sinais de entrada nem métodos de previsão.

## Cor: trinca e inversão
- Gatilho: três amarelos consecutivos ou três pretos consecutivos.
- Observação: a **rodada imediatamente seguinte** tem a cor contrária?
- Contam como ocorrência apenas rodadas com essa cor; branco e repetição contam como não ocorrência.
- Uma quarta ou quinta rodada consecutiva da mesma cor não inicia um novo gatilho.
- Se o histórico tiver lacuna superior a 150 segundos, a observação fica inconclusiva.
- Referência teórica sob 15 resultados equiprováveis e independentes: **7/15 = 46,67%**.

## Branco: primeira janela após oito sem branco por hora
- Gatilho: primeira sequência contínua de oito rodadas sem branco em cada hora de Brasília.
- Considera apenas horas cuja coleta começou perto de seu início; não inventa eventos antes do trecho observado.
- Observação: existe ao menos um branco nas **11 rodadas seguintes**, todas dentro da mesma hora?
- Só pontua janelas com 11 rodadas observadas integralmente, sem lacunas. Não aproveita branco da hora seguinte.
- Referência teórica sob os mesmos pressupostos: **1 - (14/15)^11 ≈ 53,18%**.

## Métricas
O painel exibe amostras completas, número de ocorrências, taxa observada, faixa de incerteza Wilson de 95%, rodadas inconclusivas e até seis exemplos recentes. A indicação de 30 amostras é apenas um mínimo de prudência, **não uma validação de padrão**. Testar muitos padrões no mesmo histórico também aumenta a chance de encontrar coincidências.

## Origem e limites
O laboratório analisa somente rodadas oficiais previamente aceitas e salvas pelo One For All, sem dados simulados, sem importação manual, sem TipMiner e sem scraping de terceiros. Aumentou-se o armazenamento local de 300 para 2.000 rodadas **acumuladas ao longo do uso** — não significa que a API entregue 2.000 de uma vez.

**A conectividade no GitHub Pages permanece condicionada ao CORS e às permissões da API Blitz.** Adicionar estratégias não corrige por si só uma consulta bloqueada; o painel apresenta dados apenas quando houver histórico oficial salvo.

Testes: `node --test tests/*.test.cjs`.
