# One For All - atualiza��o autom�tica no PC

1. Instale Python 3.10 ou mais recente, se ainda n�o tiver.
2. Baixe e extraia o ZIP completo deste reposit�rio.
3. Abra `INICIAR.bat`. O painel abre em http://127.0.0.1:8765.
4. Mantenha a janela do Python aberta. N�o abra `index.html` diretamente.

Tamb�m � poss�vel executar `python server.py --open` ou `python server.py --port 8766 --open`.
N�o s�o necess�rios pacotes pip nem chaves de API.

O Python consulta a Blitz a cada 15 segundos ap�s concluir a consulta anterior.
Assim que recebe uma resposta v�lida, envia os dados �s p�ginas abertas por SSE.
A grade, o hist�rico e o experimento de 11 rodadas atualizam sem recarregar a p�gina.
M�ltiplas abas compartilham a mesma coleta. A p�gina reconecta automaticamente se
o Python for reiniciado. O hist�rico continua no armazenamento do navegador.

Isso n�o � uma conex�o WebSocket com a Blitz: pode haver atraso de at� um ciclo
de consulta, mais o tempo de resposta da API. A p�gina informa falhas e resultados antigos.
HTTP 429 pausa pelo menos 30 minutos e respeita Retry-After quando maior. HTTP
401/403/451 suspende a coleta, sem tentar contornar o bloqueio.

GitHub Pages hospeda apenas os arquivos est�ticos e **n�o executa Python**.
O modo autom�tico com SSE funciona no endere�o local aberto pelo `INICIAR.bat`.
A vers�o est�tica mant�m o modo anterior de consulta direta, sujeito a CORS e
com intervalo de dois minutos. Nenhum servi�o externo foi implantado.

O experimento existente � preservado: primeiro par amarelo de cada hora,
seguido de at� 11 rodadas. Apenas estudo estat�stico, sem apostas.

## Verifica��o

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p "test_*.py"
```

Os testes do servidor usam respostas simuladas e conex�o local; n�o consultam a Blitz.
