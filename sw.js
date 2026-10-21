/* ==========================================================================
   CONSULTA DE CEP — SERVICE WORKER (sw.js)
   ==========================================================================

   O QUE É UM SERVICE WORKER?

   É um script JavaScript especial que o navegador roda em SEGUNDO PLANO,
   separado da página. Ele continua existindo mesmo quando a aba está fechada
   e tem um superpoder: pode INTERCEPTAR todas as requisições de rede que a
   aplicação faz.

   Pense nele como um "porteiro" entre a aplicação e a internet. A cada
   pedido de arquivo, ele decide:

     - devolvo uma cópia que já tenho guardada (cache)?  -> rápido, funciona offline
     - busco na internet?                                -> dados sempre atualizados

   É esse porteiro que permite a um PWA abrir mesmo sem conexão.

   ==========================================================================
   DIFERENÇAS IMPORTANTES EM RELAÇÃO AO script.js
   ==========================================================================

   1. Ele NÃO tem acesso ao DOM. Aqui não existe document, window, nem
      qualquer elemento da página. Tentar usá-los causaria erro.
   2. O objeto global dele se chama "self" (e não "window").
   3. Ele só funciona em http:// ou https:// — abrir o index.html direto do
      disco (file://) não registra o service worker.

   ==========================================================================
   O CICLO DE VIDA (os 3 eventos deste arquivo)
   ==========================================================================

     install  -> roda UMA vez, quando o service worker é instalado.
                 Momento de baixar e guardar os arquivos no cache.

     activate -> roda quando ele assume o controle da aplicação.
                 Momento de apagar caches de versões antigas.

     fetch    -> roda a CADA requisição de rede da aplicação.
                 Momento de decidir entre cache e rede.

   ========================================================================== */

"use strict";


/* ==========================================================================
   PASSO 1 — IDENTIFICAÇÃO DA VERSÃO DO CACHE
   ==========================================================================

   O navegador pode manter vários caches, cada um com um nome. Usamos o nome
   como número de versão.

   REGRA PRÁTICA MUITO IMPORTANTE: sempre que você alterar o HTML, o CSS ou o
   JS do projeto, mude este nome (v1 -> v2 -> v3...).

   Por quê? Porque o navegador serve os arquivos do cache antigo. Trocando o
   nome, criamos um cache novo e o evento "activate" apaga o anterior,
   garantindo que o usuário receba a versão atualizada do app.
   ========================================================================== */

const NOME_DO_CACHE = "consulta-cep-v1";


/* ==========================================================================
   PASSO 2 — ARQUIVOS DO "APP SHELL"
   ==========================================================================

   "App shell" (casca do aplicativo) é o conjunto mínimo de arquivos
   necessários para a interface aparecer na tela: estrutura, estilo, scripts
   e ícones.

   Guardando essa casca no cache, o app abre instantaneamente — e mesmo sem
   internet. O que NÃO entra aqui são os dados dinâmicos (a resposta do
   ViaCEP), pois esses precisam estar sempre atualizados.

   Os caminhos usam "./" (relativo a esta pasta) para o projeto funcionar em
   qualquer subdiretório do servidor, sem precisar de ajustes.
   ========================================================================== */

const ARQUIVOS_DO_APP = [
  "./",                            /* a raiz, que o servidor resolve como index.html */
  "./index.html",
  "./css/style.css",
  "./js/script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];


/* ==========================================================================
   PASSO 3 — EVENTO "install": GUARDAR OS ARQUIVOS NO CACHE
   ==========================================================================

   Dispara uma única vez, na instalação do service worker.

   event.waitUntil(promessa) avisa ao navegador: "não considere a instalação
   concluída até esta promessa terminar". Sem isso, o navegador poderia
   encerrar o service worker no meio do download dos arquivos.
   ========================================================================== */

self.addEventListener("install", (event) => {
  event.waitUntil(
    /* caches.open() cria (ou abre) um cache com o nome informado. */
    caches
      .open(NOME_DO_CACHE)
      /*
        addAll() baixa TODOS os arquivos da lista e os guarda no cache.

        Atenção: é uma operação "tudo ou nada". Se UM único arquivo da lista
        falhar (um caminho digitado errado, por exemplo), a instalação inteira
        é cancelada. Por isso vale conferir se todos os caminhos existem.
      */
      .then((cache) => cache.addAll(ARQUIVOS_DO_APP))
      /*
        Normalmente um service worker novo fica "esperando" até que todas as
        abas do app sejam fechadas para assumir o controle.

        skipWaiting() dispensa essa espera: a nova versão entra em ação
        imediatamente. Ótimo para desenvolvimento e para projetos simples
        como este, em que a atualização rápida é desejável.
      */
      .then(() => self.skipWaiting())
  );
});


/* ==========================================================================
   PASSO 4 — EVENTO "activate": LIMPAR CACHES ANTIGOS
   ==========================================================================

   Dispara quando este service worker assume o controle.

   É aqui que fazemos a faxina: percorremos todos os caches existentes e
   apagamos os que não são o atual. Sem essa limpeza, versões antigas do app
   ficariam ocupando espaço no dispositivo do usuário indefinidamente.
   ========================================================================== */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      /* keys() devolve a lista com os NOMES de todos os caches salvos. */
      .keys()
      .then((nomes) =>
        /*
          Promise.all() recebe uma lista de promessas e espera TODAS
          terminarem. Usamos esse padrão para apagar vários caches em
          paralelo (mais rápido que um por vez).

          A sequência de métodos:
            filter -> mantém só os nomes DIFERENTES do cache atual
            map    -> transforma cada nome na promessa de deletá-lo
        */
        Promise.all(
          nomes
            .filter((nome) => nome !== NOME_DO_CACHE)
            .map((nome) => caches.delete(nome))
        )
      )
      /*
        clients.claim() faz este service worker assumir o controle das abas
        que já estavam abertas, sem precisar recarregar a página.
      */
      .then(() => self.clients.claim())
  );
});


/* ==========================================================================
   PASSO 5 — EVENTO "fetch": DECIDIR ENTRE CACHE E REDE
   ==========================================================================

   Este é o coração do service worker. Ele dispara a cada requisição que a
   aplicação faz: o HTML, o CSS, o JS, os ícones e também as chamadas à API.

   Nossa estratégia será "stale-while-revalidate" (explicada no passo 5.4).
   Antes dela, três verificações decidem quando NÃO vamos interferir.
   ========================================================================== */

self.addEventListener("fetch", (event) => {
  /* Desestruturação: extrai a propriedade request do evento. */
  const { request } = event;

  /*
    ----- 5.1 Só tratamos requisições GET -----

    GET é o método usado para BUSCAR recursos. Outros métodos (POST, PUT,
    DELETE) servem para ENVIAR ou MODIFICAR dados — e respostas desse tipo
    nunca devem ser cacheadas, pois cada envio é único.

    Quando saímos da função sem chamar event.respondWith(), o navegador
    simplesmente segue o caminho normal, como se o service worker não
    existisse. É exatamente o que queremos nestes casos.
  */
  if (request.method !== "GET") {
    return;
  }

  /* O construtor URL separa um endereço em partes úteis (origin, pathname...). */
  const url = new URL(request.url);

  /*
    ----- 5.2 Consultas ao ViaCEP vão SEMPRE direto para a rede -----

    Esta é uma decisão de projeto deliberada e vale entender bem o motivo.

    Cachear a resposta de um CEP traria um problema sério: se o endereço
    mudasse (ou se a primeira resposta tivesse sido um erro), o usuário
    continuaria recebendo o dado velho para sempre.

    Regra geral que você pode levar para outros projetos:
      - ARQUIVOS estáticos (HTML, CSS, JS, imagens) -> cache é ótimo
      - DADOS dinâmicos de uma API                   -> busque sempre na rede
  */
  if (url.origin === "https://viacep.com.br") {
    return;
  }

  /*
    ----- 5.3 Ignoramos requisições para outros domínios -----

    self.location.origin é o endereço onde a nossa aplicação está hospedada.
    Se a requisição aponta para outro domínio, deixamos o navegador cuidar
    dela. Só gerenciamos o cache dos NOSSOS próprios arquivos.
  */
  if (url.origin !== self.location.origin) {
    return;
  }

  /*
    ----- 5.4 Estratégia "stale-while-revalidate" -----

    O nome significa "(serve o) desatualizado enquanto revalida". A ideia:

      1. Se existe uma cópia no cache, entregue ela IMEDIATAMENTE
         (a tela aparece instantaneamente, sem esperar a rede);
      2. Em paralelo, busque a versão atual na rede e atualize o cache
         (na próxima visita, o usuário já recebe a versão nova);
      3. Se não havia nada no cache, aguarde a resposta da rede;
      4. Se a rede falhar e houver cache, use o cache (modo offline).

    O resultado é o melhor dos dois mundos: velocidade de cache com
    atualização automática em segundo plano.

    event.respondWith(promessa) diz ao navegador: "eu assumo esta
    requisição; use a resposta desta promessa".
  */
  event.respondWith(
    /* caches.match() procura uma resposta salva para esta requisição.
       Devolve a resposta encontrada ou undefined se não houver nada. */
    caches.match(request).then((respostaDoCache) => {
      /* Dispara a busca na rede (sem await: queremos que rode em paralelo). */
      const respostaDaRede = fetch(request)
        .then((resposta) => {
          /* Só guardamos respostas bem-sucedidas (status 200-299). */
          if (resposta && resposta.ok) {
            /*
              PONTO DELICADO: uma Response só pode ser LIDA UMA VEZ — o corpo
              dela é um fluxo de dados que se esgota.

              Como precisamos usá-la duas vezes (entregar ao navegador E
              salvar no cache), fazemos uma CÓPIA com clone(). Sem o clone,
              aconteceria um erro de "corpo já consumido".
            */
            const copia = resposta.clone();
            caches.open(NOME_DO_CACHE).then((cache) => cache.put(request, copia));
          }

          return resposta;
        })
        /* Se a rede falhar (usuário offline), recorremos ao cache. */
        .catch(() => respostaDoCache);

      /*
        O operador || devolve o primeiro valor "verdadeiro".

        Como respostaDoCache é undefined quando não há nada salvo, a leitura
        fica: "entregue o cache se existir; caso contrário, espere a rede".
      */
      return respostaDoCache || respostaDaRede;
    })
  );
});
