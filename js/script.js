/* ==========================================================================
   CONSULTA DE CEP — COMPORTAMENTO DA APLICAÇÃO (JavaScript)
   ==========================================================================

   Este arquivo contém toda a LÓGICA da aplicação. É ele que:

     - aplica a máscara no CEP enquanto o usuário digita (01001-000);
     - valida se o CEP tem exatamente 8 dígitos;
     - consulta o endereço na API pública do ViaCEP;
     - monta o card com os dados recebidos;
     - exibe mensagens de erro quando algo dá errado;
     - registra o service worker (parte do PWA).

   ROTEIRO DO ARQUIVO (as seções aparecem nesta ordem):

     PASSO 1 — Constantes de configuração
     PASSO 2 — Captura dos elementos da interface
     PASSO 3 — Estado da aplicação
     PASSO 4 — Máscara do CEP
     PASSO 5 — Validação
     PASSO 6 — Consulta à API (ViaCEP)
     PASSO 7 — Atualização da interface
     PASSO 8 — Fluxo principal (junta tudo)
     PASSO 9 — Registro dos eventos
     PASSO 10 — Service worker (PWA)

   ==========================================================================
   SOBRE A ESTRUTURA "(() => { ... })()"
   ==========================================================================

   Todo o código está dentro de uma IIFE (Immediately Invoked Function
   Expression, ou "função imediatamente invocada"). Na prática:

     (() => {   // declaramos uma função...
        ...
     })();      // ...e a executamos na mesma hora

   Por que fazer isso? Para criar um ESCOPO PRIVADO.

   Tudo que declaramos aqui dentro (variáveis e funções) fica isolado e NÃO
   vaza para o escopo global da página. Isso evita que nossos nomes entrem em
   conflito com outros scripts e deixa claro quais partes pertencem ao nosso
   módulo.
   ========================================================================== */

(() => {
  /*
    "use strict" ativa o modo estrito do JavaScript, que:
      - proíbe criar variáveis sem declarar (const/let);
      - transforma alguns erros silenciosos em erros visíveis;
      - impede atribuições inválidas.
    É considerado boa prática usar sempre.
  */
  "use strict";


  /* ========================================================================
     PASSO 1 — CONSTANTES DE CONFIGURAÇÃO
     ========================================================================

     Começamos reunindo em um só lugar todos os valores fixos do projeto:
     a URL da API, os textos das mensagens e a lista de campos exibidos.

     Essa prática tem nome: evitar "magic strings" (textos soltos espalhados
     pelo código). Benefícios diretos:
       - para mudar um texto, você edita UMA linha, aqui no topo;
       - o nome da constante documenta o propósito do valor;
       - evita erros de digitação repetidos pelo arquivo.

     Usamos const porque esses valores nunca mudam, e MAIÚSCULAS_COM_UNDERSCORE
     é a convenção da comunidade para marcar constantes de configuração.
     ======================================================================== */

  /* Endereço base da API do ViaCEP. A URL final montada fica assim:
     https://viacep.com.br/ws/01001000/json/                                */
  const URL_BASE_VIACEP = "https://viacep.com.br/ws";

  /* ----- Textos do botão ----- */
  const TEXTO_BOTAO_PADRAO = "Consultar CEP";
  const TEXTO_BOTAO_CARREGANDO = "Consultando...";

  /* ----- Mensagens de erro -----
     São três situações bem diferentes, então cada uma tem a sua mensagem.
     Mensagens específicas ajudam o usuário a entender o que fazer. */
  const MENSAGEM_CEP_INVALIDO = "Informe um CEP válido com 8 dígitos.";
  const MENSAGEM_CEP_NAO_ENCONTRADO = "CEP não encontrado. Verifique o número informado e tente novamente.";
  const MENSAGEM_ERRO_CONSULTA = "Não foi possível realizar a consulta. Tente novamente.";

  /*
    ----- Campos exibidos no card de resultado -----

    Esta é uma lista (array) de objetos. Cada objeto representa UM campo e faz
    a ponte entre dois mundos:

      chave  -> o nome exato que a API do ViaCEP usa no JSON de resposta
      rotulo -> o texto amigável que mostramos na tela

    Exemplo: a API devolve "localidade", mas o usuário entende "Cidade".

    Por que usar uma lista em vez de escrever os campos um por um no HTML?
      1. A ORDEM da lista define a ordem na tela — basta reordenar aqui.
      2. Adicionar um novo campo é acrescentar uma linha, sem mexer no resto.
      3. O código que desenha o resultado fica curto: apenas percorre a lista.

    Esse padrão se chama "configuração orientada a dados": a lógica é genérica
    e os dados ditam o resultado.
  */
  const CAMPOS_DO_ENDERECO = [
    { chave: "cep", rotulo: "CEP" },
    { chave: "logradouro", rotulo: "Logradouro" },
    { chave: "complemento", rotulo: "Complemento" },
    { chave: "bairro", rotulo: "Bairro" },
    { chave: "localidade", rotulo: "Cidade" },
    { chave: "estado", rotulo: "Estado" },
    { chave: "uf", rotulo: "UF" },
    { chave: "regiao", rotulo: "Região" },
    { chave: "ibge", rotulo: "Código IBGE" },
    { chave: "ddd", rotulo: "DDD" },
  ];


  /* ========================================================================
     PASSO 2 — CAPTURA DOS ELEMENTOS DA INTERFACE
     ========================================================================

     Para o JavaScript conseguir ler ou alterar algo na tela, ele precisa
     primeiro obter uma REFERÊNCIA ao elemento HTML.

     document.getElementById("algum-id") procura no documento o elemento que
     tem aquele id e devolve um objeto que representa esse elemento.

     Guardamos essas referências em constantes UMA ÚNICA VEZ, aqui no início,
     em vez de buscar o elemento novamente a cada uso. Duas razões:
       - desempenho: buscar no documento tem custo, ainda que pequeno;
       - clareza: fica evidente, em um só lugar, de quais elementos da tela o
         nosso código depende.

     Lembre-se: isso só funciona porque a tag <script> está no final do
     <body>. Se estivesse no <head>, o HTML ainda não existiria e todas estas
     constantes receberiam null.
     ======================================================================== */

  const formulario = document.getElementById("formulario-cep");   // <form>
  const campoCep = document.getElementById("campo-cep");          // <input>
  const botaoConsultar = document.getElementById("botao-consultar"); // <button>
  const botaoTexto = document.getElementById("botao-texto");      // texto do botão
  const mensagemErro = document.getElementById("mensagem-erro");  // <p> de erro
  const cardResultado = document.getElementById("card-resultado"); // <section>
  const resultadoLista = document.getElementById("resultado-lista"); // <dl>


  /* ========================================================================
     PASSO 3 — ESTADO DA APLICAÇÃO
     ========================================================================

     "Estado" é toda informação que muda durante o uso do app e que precisamos
     lembrar. Aqui temos apenas uma: se há ou não uma consulta em andamento.

     Usamos let (e não const) porque este valor MUDA ao longo da execução:
       const -> o valor nunca é reatribuído
       let   -> o valor pode ser reatribuído

     Para que serve esta variável? Para impedir CONSULTAS DUPLICADAS. Se o
     usuário clicar no botão várias vezes rapidinho, cada clique dispararia
     uma requisição à API. Com esta "trava", os cliques extras são ignorados
     enquanto a primeira consulta não terminar.
     ======================================================================== */

  let consultaEmAndamento = false;


  /* ========================================================================
     PASSO 4 — MÁSCARA DO CEP
     ========================================================================

     Máscara é a formatação visual aplicada enquanto o usuário digita.
     Queremos que "01001000" apareça automaticamente como "01001-000".

     Repare na divisão do trabalho: temos uma função que FORMATA (coloca a
     máscara) e outra que LIMPA (remove a máscara). Cada função faz uma coisa
     só — princípio da responsabilidade única.
     ======================================================================== */

  /**
   * Formata um texto qualquer no padrão de CEP "00000-000".
   *
   * Como funciona, passo a passo:
   *   1. Remove tudo que não é dígito;
   *   2. Mantém no máximo 8 dígitos (um CEP não tem mais que isso);
   *   3. Se já houver mais de 5 dígitos, insere o hífen depois do 5º.
   *
   * Exemplos:
   *   "0"          -> "0"
   *   "01001"      -> "01001"
   *   "010010"     -> "01001-0"
   *   "01001000"   -> "01001-000"
   *   "abc01001000" -> "01001-000"
   *
   * @param {string} valor Texto digitado pelo usuário.
   * @returns {string} O mesmo valor, já formatado com a máscara.
   */
  function aplicarMascaraCep(valor) {
    /*
      Vamos destrinchar a expressão abaixo:

        valor.replace(/\D/g, "")

      /\D/g é uma EXPRESSÃO REGULAR (regex), um padrão de busca em texto:
        \D -> "qualquer caractere que NÃO seja dígito" (o \d maiúsculo nega)
        g  -> flag "global": aplica em TODAS as ocorrências, não só na primeira

      Então replace(/\D/g, "") significa: "troque todo caractere não numérico
      por nada", ou seja, apague tudo que não for número.

      Em seguida, .slice(0, 8) corta o texto do índice 0 até o 8 (exclusive),
      garantindo no máximo 8 dígitos.
    */
    const digitos = valor.replace(/\D/g, "").slice(0, 8);

    /*
      Só faz sentido inserir o hífen depois que o usuário passar do 5º dígito.
      Antes disso, devolvemos apenas os números já digitados.
    */
    if (digitos.length > 5) {
      /*
        Template literal (o texto entre acentos graves ` `) permite inserir
        valores dentro do texto com a sintaxe ${...}. É mais legível que
        concatenar com o sinal de +.

        slice(0, 5) -> os 5 primeiros dígitos  ("01001")
        slice(5)    -> do 6º dígito em diante  ("000")
      */
      return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
    }

    return digitos;
  }

  /**
   * Remove a máscara, devolvendo somente os dígitos.
   *
   * É a etapa obrigatória antes de consultar a API, porque o ViaCEP espera o
   * CEP sem o hífen na URL.
   *
   * Exemplo: "01001-000" -> "01001000"
   *
   * @param {string} valor Texto com ou sem máscara.
   * @returns {string} Apenas os dígitos encontrados.
   */
  function removerMascaraCep(valor) {
    return valor.replace(/\D/g, "");
  }


  /* ========================================================================
     PASSO 5 — VALIDAÇÃO
     ========================================================================

     Validar ANTES de chamar a API é importante por dois motivos:
       - não desperdiçamos uma requisição que já sabemos que vai falhar;
       - o usuário recebe o aviso instantaneamente, sem esperar a rede.
     ======================================================================== */

  /**
   * Verifica se o texto contém exatamente 8 dígitos numéricos.
   *
   * A regex /^\d{8}$/ é lida da seguinte forma:
   *   ^     -> início do texto
   *   \d    -> um dígito (0 a 9)
   *   {8}   -> exatamente 8 vezes o padrão anterior
   *   $     -> fim do texto
   *
   * Os âncoras ^ e $ são essenciais: sem eles, um texto como "1234567890"
   * seria aprovado, porque contém 8 dígitos "em algum lugar". Com eles,
   * exigimos que o texto INTEIRO seja composto por exatamente 8 dígitos.
   *
   * O método .test() devolve true ou false.
   *
   * @param {string} digitos CEP já sem máscara.
   * @returns {boolean} true se o CEP tem o formato esperado.
   */
  function cepEhValido(digitos) {
    return /^\d{8}$/.test(digitos);
  }


  /* ========================================================================
     PASSO 6 — CONSULTA À API (ViaCEP)
     ========================================================================

     Aqui acontece a comunicação com a internet. Usamos fetch(), a função
     nativa do navegador para fazer requisições HTTP — não precisamos de
     nenhuma biblioteca externa.

     CONCEITO IMPORTANTE: CÓDIGO ASSÍNCRONO

     Buscar dados na internet leva tempo (décimos de segundo, às vezes mais).
     O JavaScript não fica parado esperando: ele continua executando e avisa
     quando a resposta chegar. Isso é código assíncrono.

     As palavras-chave async/await deixam esse código assíncrono com a mesma
     aparência de um código comum, de cima para baixo:

       async -> marca a função como assíncrona (ela sempre devolve uma Promise)
       await -> "aguarde aqui até o resultado chegar, e só então continue"

     Só é permitido usar await dentro de uma função marcada com async.
     ======================================================================== */

  /**
   * Consulta um CEP na API do ViaCEP.
   *
   * @param {string} digitos CEP com 8 dígitos, sem máscara.
   * @returns {Promise<object>} Os dados do endereço (objeto já convertido de JSON).
   * @throws {Error} Se a resposta HTTP não indicar sucesso.
   */
  async function consultarCepNaApi(digitos) {
    /*
      Montamos a URL final com template literal. Para "01001000", a URL fica:
      https://viacep.com.br/ws/01001000/json/

      O await faz a função pausar aqui até o servidor responder.
    */
    const resposta = await fetch(`${URL_BASE_VIACEP}/${digitos}/json/`);

    /*
      ATENÇÃO, pegadinha clássica do fetch:

      O fetch NÃO lança erro automaticamente quando o servidor responde 404 ou
      500. Para ele, "recebi uma resposta do servidor" já é sucesso — mesmo
      que a resposta seja um erro.

      Por isso precisamos checar manualmente a propriedade resposta.ok, que é
      true quando o código HTTP está na faixa 200-299.

      Quando não está, lançamos um erro com throw. Esse erro vai ser capturado
      pelo bloco try/catch do PASSO 8.
    */
    if (!resposta.ok) {
      throw new Error(`Erro na requisição: ${resposta.status}`);
    }

    /*
      O servidor devolve o conteúdo como texto JSON. O método .json() lê esse
      texto e o converte em um objeto JavaScript que podemos usar.

      Essa leitura também é assíncrona, então precisa de await.
    */
    return resposta.json();
  }


  /* ========================================================================
     PASSO 7 — ATUALIZAÇÃO DA INTERFACE
     ========================================================================

     As funções desta seção têm uma única missão: refletir na tela o que está
     acontecendo. Elas não validam nem consultam nada — só mexem no visual.

     Essa separação (lógica de um lado, interface do outro) é o que mantém o
     código organizado e fácil de entender quando o projeto cresce.
     ======================================================================== */

  /**
   * Exibe uma mensagem de erro e marca o campo como inválido.
   *
   * @param {string} mensagem Texto a ser mostrado ao usuário.
   */
  function mostrarErro(mensagem) {
    /*
      Usamos textContent (e nunca innerHTML) para inserir texto.

      Diferença crucial:
        textContent -> insere como TEXTO PURO. Seguro.
        innerHTML   -> interpreta o conteúdo como HTML. Se o texto vier de
                       fora (do usuário ou de uma API), alguém poderia
                       injetar código malicioso na sua página. Esse tipo de
                       ataque se chama XSS (Cross-Site Scripting).

      Regra prática: se você quer mostrar texto, use textContent.
    */
    mensagemErro.textContent = mensagem;

    /* Definir hidden = false torna o parágrafo visível. */
    mensagemErro.hidden = false;

    /* classList.add insere uma classe CSS. A classe "invalido" pinta a borda
       do campo de vermelho (ver seção 6.4 do style.css). */
    campoCep.classList.add("invalido");
  }

  /**
   * Esconde a mensagem de erro e devolve o campo ao estado normal.
   * É o oposto exato de mostrarErro().
   */
  function limparErro() {
    mensagemErro.textContent = "";
    mensagemErro.hidden = true;
    campoCep.classList.remove("invalido");
  }

  /**
   * Esconde o card de resultado e apaga seu conteúdo.
   *
   * Por que apagar o conteúdo, se o card já está escondido?
   * Para evitar que dados de uma consulta antiga reapareçam por um instante
   * na próxima consulta. Limpar sempre deixa o comportamento previsível.
   */
  function esconderResultado() {
    cardResultado.hidden = true;
    resultadoLista.innerHTML = "";
  }

  /**
   * Monta e exibe o card com os dados do endereço.
   *
   * Esta é a função mais interessante do arquivo: ela CRIA elementos HTML
   * dinamicamente, a partir dos dados recebidos da API.
   *
   * @param {object} dados Objeto devolvido pelo ViaCEP.
   */
  function exibirResultado(dados) {
    /* Começamos limpando o conteúdo anterior, garantindo que a nova consulta
       substitua a antiga em vez de somar a ela. */
    resultadoLista.innerHTML = "";

    /*
      forEach percorre a lista CAMPOS_DO_ENDERECO item por item.

      O trecho ({ chave, rotulo }) usa DESESTRUTURAÇÃO (destructuring): em vez
      de receber o objeto inteiro e escrever campo.chave e campo.rotulo, já
      extraímos as duas propriedades direto nos parâmetros. É equivalente a:

        CAMPOS_DO_ENDERECO.forEach(function (campo) {
          const chave = campo.chave;
          const rotulo = campo.rotulo;
          ...
        });
    */
    CAMPOS_DO_ENDERECO.forEach(({ chave, rotulo }) => {
      /*
        dados[chave] é acesso por COLCHETES. Usamos esta forma porque o nome
        da propriedade está em uma variável.

          dados.logradouro  -> acesso por ponto, nome fixo escrito no código
          dados["logradouro"] = dados[chave] -> nome vindo de uma variável

        É exatamente isso que permite a esta função ser genérica: ela não
        conhece os campos de antemão, apenas lê o que a lista indicar.
      */
      const valor = dados[chave];

      /*
        Pulamos campos vazios. O ViaCEP frequentemente devolve "" em
        complemento, por exemplo, e mostrar um rótulo sem valor só poluiria
        a tela.

        O return aqui dentro do forEach encerra apenas ESTA volta do laço e
        segue para o próximo campo (funciona como o "continue" de um for).
      */
      if (!valor) {
        return;
      }

      /*
        Agora criamos a estrutura HTML desta linha. O resultado final para o
        campo "Logradouro" será:

          <div class="resultado-linha">
            <dt>Logradouro</dt>
            <dd>Praça da Sé</dd>
          </div>

        São três passos para cada elemento:
          1. createElement -> cria o elemento na memória
          2. definir conteúdo/classe
          3. append/appendChild -> encaixa o elemento na página
      */
      const linha = document.createElement("div");
      linha.className = "resultado-linha";

      /* <dt> = termo da lista de descrição (o rótulo) */
      const termo = document.createElement("dt");
      termo.textContent = rotulo;

      /* <dd> = descrição (o valor) */
      const descricao = document.createElement("dd");
      descricao.textContent = valor;

      /* append aceita vários elementos de uma vez: coloca <dt> e <dd> dentro
         da <div class="resultado-linha">. */
      linha.append(termo, descricao);

      /* Por fim, a linha pronta entra na <dl> que está na página. */
      resultadoLista.appendChild(linha);
    });

    /* Com o conteúdo montado, revelamos o card. A animação "surgir" definida
       no CSS faz a entrada suave acontecer automaticamente. */
    cardResultado.hidden = false;
  }

  /**
   * Liga ou desliga o estado visual de carregamento.
   *
   * Três coisas acontecem juntas quando a consulta começa:
   *   1. a trava anti-cliques-duplicados é ativada;
   *   2. o botão é desabilitado e troca de texto;
   *   3. o spinner aparece.
   *
   * Centralizar tudo em uma função só evita estados inconsistentes, como o
   * spinner continuar girando depois que a consulta já acabou.
   *
   * @param {boolean} carregando true para iniciar, false para finalizar.
   */
  function definirCarregando(carregando) {
    consultaEmAndamento = carregando;

    /* Um botão com disabled = true não responde a cliques nem recebe foco. */
    botaoConsultar.disabled = carregando;

    /*
      classList.toggle(classe, condicao) é um atalho muito útil:
        condicao true  -> adiciona a classe
        condicao false -> remove a classe
      Equivale a um if/else com add() e remove().
    */
    botaoConsultar.classList.toggle("carregando", carregando);

    /* Operador ternário: condicao ? valorSeVerdadeiro : valorSeFalso.
       É uma forma compacta de escrever um if/else que devolve um valor. */
    botaoTexto.textContent = carregando ? TEXTO_BOTAO_CARREGANDO : TEXTO_BOTAO_PADRAO;
  }


  /* ========================================================================
     PASSO 8 — FLUXO PRINCIPAL
     ========================================================================

     Chegou a hora de juntar todas as peças. As duas funções desta seção são
     "tratadores de evento" (event handlers): elas são chamadas pelo navegador
     quando o usuário faz algo.
     ======================================================================== */

  /**
   * Executada a CADA tecla digitada no campo de CEP.
   *
   * @param {Event} evento Objeto com informações sobre o que aconteceu.
   */
  function aoDigitarCep(evento) {
    /*
      evento.target é o elemento que originou o evento — neste caso, o próprio
      <input>. Lemos o valor atual, aplicamos a máscara e escrevemos de volta.
      É essa reescrita que faz o hífen "aparecer sozinho" durante a digitação.
    */
    evento.target.value = aplicarMascaraCep(evento.target.value);

    /*
      Boa prática de experiência do usuário: assim que a pessoa começa a
      corrigir o campo, o erro antigo some. Manter uma mensagem de erro na
      tela enquanto o usuário já está digitando outra coisa é frustrante.
    */
    limparErro();

    /* Se o campo foi completamente apagado, escondemos o resultado anterior
       para deixar a tela limpa, como no estado inicial do app. */
    if (evento.target.value === "") {
      esconderResultado();
    }
  }

  /**
   * Executada quando o formulário é enviado — tanto pelo clique no botão
   * quanto pela tecla Enter.
   *
   * Esta função orquestra todos os passos anteriores na ordem correta.
   *
   * @param {Event} evento Evento de submit do formulário.
   */
  async function aoEnviarFormulario(evento) {
    /*
      ----- 8.1 Impedir o comportamento padrão -----

      Por padrão, enviar um formulário RECARREGA a página. Isso apagaria tudo
      e quebraria a aplicação.

      preventDefault() cancela esse comportamento, permitindo que a gente
      trate o envio por conta própria em JavaScript. Em formulários
      controlados por JS, esta é quase sempre a primeira linha.
    */
    evento.preventDefault();

    /*
      ----- 8.2 Trava contra consultas duplicadas -----
      Se uma consulta já está rodando, simplesmente saímos da função.
    */
    if (consultaEmAndamento) {
      return;
    }

    /*
      ----- 8.3 Limpar a tela antes de começar -----
      Sempre partimos de um estado limpo: sem erros antigos e sem o resultado
      da consulta anterior.
    */
    limparErro();
    esconderResultado();

    /* ----- 8.4 Preparar o dado: tirar a máscara ----- */
    const digitos = removerMascaraCep(campoCep.value);

    /*
      ----- 8.5 Validar -----
      "Early return" (retorno antecipado): se o dado é inválido, avisamos e
      encerramos aqui mesmo. Nenhuma requisição é feita.

      Esse estilo evita aninhar vários if dentro de if e deixa o caminho
      principal do código mais plano e legível.
    */
    if (!cepEhValido(digitos)) {
      mostrarErro(MENSAGEM_CEP_INVALIDO);
      return;
    }

    /* ----- 8.6 Ativar o estado de carregamento ----- */
    definirCarregando(true);

    /*
      ----- 8.7 Consultar a API com tratamento de erros -----

      O bloco try/catch/finally tem três partes:

        try     -> o código que PODE dar erro (rede fora do ar, por exemplo)
        catch   -> executa SE um erro ocorrer dentro do try
        finally -> executa SEMPRE, com erro ou sem erro

      O finally é perfeito para "faxina": aqui garantimos que o estado de
      carregamento seja desligado em qualquer cenário. Sem ele, um erro de
      rede deixaria o botão travado e o spinner girando para sempre.
    */
    try {
      const dados = await consultarCepNaApi(digitos);

      /*
        CASO ESPECIAL DO VIACEP:

        Quando o CEP tem formato válido mas não existe, o ViaCEP responde com
        status HTTP 200 (sucesso!) e um corpo assim:

          { "erro": "true" }

        Ou seja, do ponto de vista da rede deu tudo certo — quem precisa
        detectar o problema é a nossa aplicação, verificando a propriedade
        "erro" nos dados recebidos.

        Esta é uma lição valiosa: cada API tem suas particularidades. Ler a
        documentação (e testar os casos de erro) é parte do trabalho.
      */
      if (dados.erro) {
        mostrarErro(MENSAGEM_CEP_NAO_ENCONTRADO);
        return; /* o finally ainda será executado, mesmo com este return */
      }

      /* ----- 8.8 Sucesso: desenhar o endereço na tela ----- */
      exibirResultado(dados);
    } catch (erro) {
      /*
        Caímos aqui quando algo falha de verdade: sem internet, servidor fora
        do ar, resposta malformada, etc.

        Mostramos ao usuário uma mensagem simples e amigável — detalhes
        técnicos do erro não ajudariam quem está usando o app.
      */
      mostrarErro(MENSAGEM_ERRO_CONSULTA);
    } finally {
      /* Desliga o carregamento em TODOS os caminhos possíveis. */
      definirCarregando(false);
    }
  }


  /* ========================================================================
     PASSO 9 — REGISTRO DOS EVENTOS
     ========================================================================

     Até agora só DEFINIMOS funções; nada foi executado. Agora conectamos cada
     função ao evento que deve dispará-la.

     addEventListener("nome-do-evento", funcaoQueResponde) significa:
     "quando este evento acontecer neste elemento, chame esta função".

     Note que passamos a função SEM os parênteses:
       correto: addEventListener("input", aoDigitarCep)
       errado : addEventListener("input", aoDigitarCep())

     No segundo caso, a função seria executada imediatamente e o resultado
     dela (undefined) seria registrado como ouvinte. Queremos entregar a
     função em si, para o navegador chamá-la na hora certa.
     ======================================================================== */

  /* O evento "input" dispara a cada alteração no campo — inclusive em colar,
     cortar e digitar. É mais confiável que "keyup" justamente por isso. */
  campoCep.addEventListener("input", aoDigitarCep);

  /*
    Escutamos "submit" no FORMULÁRIO, e não "click" no botão. Essa escolha é
    proposital: o submit é disparado tanto pelo clique quanto pela tecla
    Enter, atendendo de uma só vez o requisito de consultar com o Enter.
  */
  formulario.addEventListener("submit", aoEnviarFormulario);


  /* ========================================================================
     PASSO 10 — SERVICE WORKER (PWA)
     ========================================================================

     Um SERVICE WORKER é um script que roda em segundo plano, separado da
     página, e pode interceptar as requisições de rede. É ele que permite à
     aplicação abrir mesmo sem internet, servindo arquivos guardados em cache.

     A lógica do nosso service worker está no arquivo sw.js. Aqui apenas
     fazemos o REGISTRO dele.
     ======================================================================== */

  /*
    DETECÇÃO DE RECURSO (feature detection):

    Antes de usar uma API moderna, verificamos se o navegador a suporta.
    "serviceWorker" in navigator pergunta: "existe a propriedade serviceWorker
    dentro do objeto navigator?".

    Se não existir, simplesmente não registramos nada — e o app continua
    funcionando normalmente, só sem o recurso offline. Essa estratégia se
    chama MELHORIA PROGRESSIVA (progressive enhancement): o essencial funciona
    em todo lugar, e os extras aparecem onde há suporte.
  */
  if ("serviceWorker" in navigator) {
    /*
      Esperamos o evento "load" (página totalmente carregada) para registrar.
      Motivo: o registro consome rede e processamento, e não queremos que ele
      concorra com o carregamento do conteúdo que o usuário quer ver agora.
    */
    window.addEventListener("load", () => {
      /*
        register() devolve uma Promise. Encadeamos .catch() para tratar uma
        eventual falha.

        Quando o registro pode falhar? Ao abrir o arquivo diretamente pelo
        sistema (protocolo file://), por exemplo — service workers exigem
        http:// ou https://.

        Deixamos o catch vazio DE PROPÓSITO, com um comentário explicando:
        a falha aqui não é crítica e não deve poluir o console nem interromper
        o uso do app. O recurso offline é um extra, não o essencial.
      */
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* Falha no registro não impede o funcionamento normal da aplicação. */
      });
    });
  }
})();
