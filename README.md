# One For All — atualização automática no PC

1. Instale Python 3.10 ou mais recente, se ainda não tiver.
2. Baixe e extraia o ZIP completo deste repositório.
3. Abra `INICIAR.bat`. O painel abre em http://127.0.0.1:8765.
4. Mantenha a janela do Python aberta. Não abra `index.html` diretamente.

Também é possível executar `python server.py --open` ou `python server.py --port 8766 --open`.
Não são necessários pacotes pip nem chaves de API.

O Python consulta a Blitz a cada 15 segundos após concluir a consulta anterior.
Assim que recebe uma resposta válida, envia os dados às páginas abertas por SSE.
A grade, o histórico e o experimento de 11 rodadas atualizam sem recarregar a página.
Múltiplas abas compartilham a mesma coleta. A página reconecta automaticamente se
o Python for reiniciado. O histórico continua no armazenamento do navegador.

Isso não é uma conexão WebSocket com a Blitz: pode haver atraso de até um ciclo
de consulta, mais o tempo de resposta da API. A página informa falhas e resultados antigos.
HTTP 429 pausa pelo menos 30 minutos e respeita Retry-After quando maior. HTTP
401/403/451 suspende a coleta, sem tentar contornar o bloqueio.

GitHub Pages hospeda apenas os arquivos estáticos e **não executa Python**.
O modo automático com SSE funciona no endereço local aberto pelo `INICIAR.bat`.
A versão estática mantém o modo anterior de consulta direta, sujeito a CORS e
com intervalo de dois minutos. Nenhum serviço externo foi implantado.

O experimento existente é preservado: primeiro par amarelo de cada hora,
seguido de até 11 rodadas. Apenas estudo estatístico, sem apostas.

## Verificação

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p "test_*.py"
```

Os testes do servidor usam respostas simuladas e conexão local; não consultam a Blitz.
