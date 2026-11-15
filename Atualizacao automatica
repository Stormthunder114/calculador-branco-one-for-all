/**
 * atualizacao-automatica.js
 * Módulo de atualização automática + persistência de histórico pro ONE FOR ALL.
 *
 * O que ele faz:
 *  - Busca periodicamente o JSON que o GitHub Actions publica (mesma origem do
 *    GitHub Pages, então sem problema de CORS) com os resultados coletados.
 *  - Funde (merge) os resultados novos com o que já está salvo no navegador
 *    (localStorage), sem duplicar rodadas.
 *  - Marca o status da conexão: "atualizado", "atrasado" ou "indisponivel".
 *  - Chama uma função sua toda vez que chegam dados novos, pra você recalcular
 *    estatísticas e redesenhar a tela — sem precisar que o usuário clique em nada.
 *
 * O que ele NÃO faz:
 *  - Não busca a API oficial da Blitz sozinho. Ela bloqueia esse tipo de
 *    requisição vinda de fora do navegador (confirmado nos testes anteriores),
 *    então isso continua dependendo do fluxo manual de copiar/colar que já existe.
 */

(function () {
  "use strict";

  // ======= AJUSTE AQUI =======
  // Caminho do JSON que o GitHub Actions publica com os resultados coletados,
  // relativo à raiz do site. Troque pelo caminho real do arquivo no repositório
  // (ex.: "data/historico.json", "resultados.json", "docs/data.json"...).
  const URL_DADOS = "data/historico.json";

  // Intervalo entre checagens automáticas (ms). 5 min é um valor respeitoso.
  const INTERVALO_MS = 5 * 60 * 1000;

  // Depois de quanto tempo sem rodada nova consideramos "atrasado".
  const LIMITE_ATRASO_MS = 90 * 60 * 1000; // 90 min

  // Quantas rodadas manter guardadas no navegador (cobre o filtro de 200 + folga).
  const MAX_RODADAS_SALVAS = 1000;

  const CHAVE_STORAGE = "oneforall_historico_v1";
  const CHAVE_ULTIMA_ATUALIZACAO = "oneforall_ultima_atualizacao_v1";

  let callbackNovosDados = null;
  let callbackStatus = null;
  let timerId = null;

  function idUnico(rodada) {
    return rodada.id || `${rodada.created_at}-${rodada.roll}-${rodada.color}`;
  }

  function carregarSalvo() {
    try {
      const bruto = localStorage.getItem(CHAVE_STORAGE);
      return bruto ? JSON.parse(bruto) : [];
    } catch (erro) {
      console.warn("Não consegui ler o histórico salvo, começando do zero:", erro);
      return [];
    }
  }

  function salvar(lista) {
    try {
      const cortada = lista.slice(-MAX_RODADAS_SALVAS);
      localStorage.setItem(CHAVE_STORAGE, JSON.stringify(cortada));
      localStorage.setItem(CHAVE_ULTIMA_ATUALIZACAO, new Date().toISOString());
      return cortada;
    } catch (erro) {
      console.warn("Não consegui salvar o histórico (quota do navegador?):", erro);
      return lista;
    }
  }

  function mesclar(existentes, recebidos) {
    const vistos = new Set(existentes.map(idUnico));
    const novos = [];
    for (const rodada of recebidos) {
      const chave = idUnico(rodada);
      if (!vistos.has(chave)) {
        vistos.add(chave);
        novos.push(rodada);
      }
    }
    if (novos.length === 0) return { lista: existentes, novos: [] };
    const combinada = existentes
      .concat(novos)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { lista: combinada, novos };
  }

  function avisarStatus(status, detalhe) {
    if (typeof callbackStatus === "function") callbackStatus(status, detalhe || null);
  }

  async function buscarEAtualizar() {
    let resposta;
    try {
      // Cache-busting leve: evita que o navegador sirva uma cópia velha do JSON.
      resposta = await fetch(`${URL_DADOS}?t=${Date.now()}`, { cache: "no-store" });
    } catch (erro) {
      avisarStatus("indisponivel", "Falha de rede ao buscar o histórico publicado.");
      return;
    }

    if (!resposta.ok) {
      avisarStatus("indisponivel", `O arquivo de dados respondeu com status ${resposta.status}.`);
      return;
    }

    let dados;
    try {
      dados = await resposta.json();
    } catch (erro) {
      avisarStatus("indisponivel", "O arquivo de dados não é um JSON válido.");
      return;
    }

    const rodadasRecebidas = Array.isArray(dados) ? dados : dados.records || [];
    const existentes = carregarSalvo();
    const { lista, novos } = mesclar(existentes, rodadasRecebidas);

    if (novos.length > 0) {
      const listaSalva = salvar(lista);
      if (typeof callbackNovosDados === "function") callbackNovosDados(listaSalva, novos);
    }

    const ultimaRodada = lista[lista.length - 1];
    const idadeMs = ultimaRodada
      ? Date.now() - new Date(ultimaRodada.created_at).getTime()
      : Infinity;

    if (idadeMs > LIMITE_ATRASO_MS) {
      avisarStatus("atrasado", `Última rodada recebida há ${Math.round(idadeMs / 60000)} min.`);
    } else {
      avisarStatus("atualizado");
    }
  }

  /**
   * Inicia o módulo.
   * @param {Object} opcoes
   * @param {(listaCompleta: Array, novasRodadas: Array) => void} opcoes.aoReceberNovosDados
   *        Chamado quando chegam rodadas novas (e uma vez de cara com o que já
   *        estava salvo). Use pra recalcular estatísticas e redesenhar a grade —
   *        substitui o clique manual no botão "Atualizar".
   * @param {(status: "atualizado"|"atrasado"|"indisponivel", detalhe?: string) => void} opcoes.aoMudarStatus
   *        Chamado a cada checagem, pra você atualizar o indicador de conexão.
   */
  function iniciar(opcoes) {
    opcoes = opcoes || {};
    callbackNovosDados = opcoes.aoReceberNovosDados || null;
    callbackStatus = opcoes.aoMudarStatus || null;

    const salvoAgora = carregarSalvo();
    if (salvoAgora.length > 0 && typeof callbackNovosDados === "function") {
      callbackNovosDados(salvoAgora, []);
    }

    buscarEAtualizar();
    timerId = setInterval(buscarEAtualizar, INTERVALO_MS);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") buscarEAtualizar();
    });
  }

  function parar() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function forcarAgora() {
    return buscarEAtualizar();
  }

  window.OneForAllAutoUpdate = { iniciar, parar, forcarAgora };
})();
