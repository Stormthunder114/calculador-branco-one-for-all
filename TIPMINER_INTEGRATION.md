# One For All — adaptador TipMiner (inativo)

Este repositório continua exibindo dados ao vivo **somente quando a API oficial da Blitz permite acesso**. O arquivo `tipminer-adapter.cjs` é um adaptador **offline**, isolado, que não realiza requisições HTTP, não inicia SSE e não foi conectado ao painel.

## Campos recebidos como especificação

O formato fornecido para Blitz4 Double do TipMiner é `uuid`, `type`, `result`, `instant`.

| type | Cor no One For All |
|---|---|
| `DEFAULT` | 2 — preto |
| `DOUBLE` | 1 — amarelo |
| `LUCKY` | 0 — branco |

`uuid` identifica a rodada; `instant` fornece o horário; `result` será preservado como número somente quando for inteiro entre 0 e 14 e combinar com a cor informada. Registros inválidos são descartados. A forma real do envelope JSON (lista direta, `history`, `records`) **ainda precisa ser validada** contra uma resposta permitida.

## Condições para conectar a API externa

O endpoint informado pelo usuário é `https://api.core.public.tipminer.com/v1/double/rounds/20686b4a-e703-46b4-9f4d-d4b45a280145/history`.

A disponibilização do endpoint em HTTP não equivale a uma licença de integração. O [TipMiner nos seus Termos de Uso](https://www.tipminer.com/br/termos-de-uso), itens 6.1(ii), 6.1(viii) e 6.1(ix), exige autorização escrita para automação, aplicativos terceiros e uso de APIs.

Para habilitar a fonte, obtenha autorização do provedor especificando domínio, finalidade de análise, intervalo de 30 segundos, armazenamento histórico, possibilidade de SSE e limites técnicos. Depois teste uma resposta real autorizada e as regras de CORS. Não contornar falhas de acesso.

## Testes

```sh
node --test tests/*.test.cjs
```

O adaptador não informa acertos futuros nem fornece sinais de aposta.
