/* ============================================================
   Salão ERP — Camada de dados (DB)
   Sistema em produção, conectado ao Supabase (ver assets/js/env-config.js
   para as chaves de conexão) — os dados moram no Supabase (Postgres),
   compartilhados entre todos os aparelhos/pessoas que acessam o sistema.
   Para não precisar reescrever as telas que já usam DB.find/insert/
   update de forma síncrona, o app carrega tudo do Supabase para um
   cache em memória assim que a página abre (aguarde `DB.ready` antes
   de usar qualquer outra função do DB), e cada escrita (insert/update/
   remove/...) atualiza esse cache na hora (para a tela responder
   rápido) e, em paralelo, envia a mesma alteração para o Supabase em
   segundo plano. Uma cópia local no navegador (IndexedDB, com reserva
   em localStorage) continua existindo como espelho rápido — não é a
   fonte de verdade, só ajuda a tela a não ficar em branco enquanto
   busca do servidor e a continuar funcionando (em modo leitura
   recente) se a internet cair no meio do uso.
   ============================================================ */

(function (global) {
  "use strict";

  var STORAGE_KEY = "salaoErpDB_v1";

  var TABLES = [
    "employees", "clients", "costCenters", "categories", "services",
    "products", "stockMovements", "transactions", "appointments",
    "bankLines", "commissionPayouts", "settings", "users", "activityLog",
    "commissionBonuses", "occurrences", "cardMachines",
    "productConsumptions", "notifications", "approvals", "chamados",
    "timeClockEntries"
  ];

  var ENV = global.ENV || {};
  var supa = null;

  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY) {
    console.error("Supabase não configurado (assets/js/env-config.js) — o sistema não consegue carregar/salvar dados sem essas chaves.");
  } else if (!global.supabase || !global.supabase.createClient) {
    console.error("Supabase JS SDK não encontrado — verifique se o <script> do CDN do Supabase está incluído ANTES de db.js.");
  } else {
    supa = global.supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }

  function emptyDB() {
    var db = {};
    TABLES.forEach(function (t) { db[t] = []; });
    db.settings = { companyName: "Guitart & Co.", createdAt: nowISO() };
    db.users = [{
      id: "usr_admin001",
      cpf: "00000000000",
      firstName: "Administrador",
      lastName: "Sistema",
      password: "123456",
      role: "Administrador",
      active: true,
      // allowedPages: array of page filenames (e.g. "index.html") this user
      // may open, as set in Configurações → Permissões. `null` (or a missing
      // field, for records saved before this feature existed) means "full
      // access to every screen" — see CurrentUser.canAccess() in auth.js.
      // The seeded default admin is explicitly set to `null` here so it can
      // never end up locked out, even if this file's schema changes later.
      allowedPages: null,
      createdAt: nowISO(),
      updatedAt: nowISO()
    }];
    return db;
  }

  function nowISO() { return new Date().toISOString(); }

  function uid(prefix) {
    var rand = Math.random().toString(36).slice(2, 9);
    var t = Date.now().toString(36).slice(-5);
    return (prefix ? prefix + "_" : "") + t + rand;
  }

  // Cargos (funções dos funcionários) — configuráveis em Configurações →
  // Cargos. Ficam guardados dentro de settings.roles (sem precisar de uma
  // tabela nova no Supabase) em vez de hardcoded no código como antes.
  // É só uma lista de nomes (sem vínculo com grupo de serviço).
  var DEFAULT_ROLES = [
    { id: "rol_cabeleireiro", name: "Cabeleireiro(a)" },
    { id: "rol_manicure", name: "Manicure e Pedicure" },
    { id: "rol_esteticista", name: "Esteticista" },
    { id: "rol_maquiador", name: "Maquiador(a)" },
    { id: "rol_recepcionista", name: "Recepcionista" },
    { id: "rol_gerente", name: "Gerente" },
    { id: "rol_financeiro", name: "Financeiro/Administrativo" },
    { id: "rol_assistente", name: "Assistente" }
  ];

  // Formas de pagamento (Concluir Atendimento / Fechar Conta, na Agenda) —
  // mesmo padrão de Cargos: configurável em Configurações → Formas de
  // Pagamento, guardado em settings.paymentMethods (sem tabela nova no
  // Supabase). `isParceria: true` marca uma forma como "o cliente não paga
  // nada" — o valor do atendimento vira só a base para dividir o custo
  // entre o profissional e o salão (ver agenda.js, telas de conclusão de
  // atendimento). A seed já inclui "Parceria" com essa flag. `isPackage:
  // true` (09/09/2026) marca a forma "Pacote" — ao concluir um atendimento
  // com essa forma de pagamento, o sistema reconhece automaticamente que a
  // sessão está sendo paga consumindo uma sessão do pacote de tratamento já
  // comprado pelo cliente (ver activePackagePurchasesForService em
  // agenda.js), sem gerar cobrança nova.
  var DEFAULT_PAYMENT_METHODS = [
    { id: "pmt_pix", name: "Pix", isParceria: false },
    { id: "pmt_credito", name: "Cartão de Crédito", isParceria: false },
    { id: "pmt_debito", name: "Cartão de Débito", isParceria: false },
    { id: "pmt_dinheiro", name: "Dinheiro", isParceria: false },
    { id: "pmt_parceria", name: "Parceria", isParceria: true },
    { id: "pmt_pacote", name: "Pacote", isParceria: false, isPackage: true }
  ];

  var _cache = null;

  // ---------------------------------------------------------------
  // Cache curto de navegação: evita refazer as 21 consultas ao Supabase
  // a cada troca de tela (o sistema é multi-página, então normalmente
  // cada navegação recarregava tudo do zero). Se já buscamos os dados
  // frescos há pouco tempo NESTA MESMA ABA do navegador, a próxima tela
  // usa direto o espelho completo do IndexedDB em vez de esperar 21
  // consultas de novo — abre na hora. Gravações (insert/update/remove)
  // continuam indo pro Supabase imediatamente em qualquer tela, sempre;
  // isso só encurta a busca inicial de leitura. Uma aba nova (sem essa
  // marca na sessionStorage) sempre busca fresco do servidor primeiro.
  var BOOT_CACHE_KEY = "salaoErpBootFreshAt_v1";
  var BOOT_CACHE_TTL_MS = 20000;

  function readBootCacheFreshAt() {
    try {
      var raw = sessionStorage.getItem(BOOT_CACHE_KEY);
      return raw ? Number(raw) : 0;
    } catch (e) { return 0; }
  }

  function markBootCacheFresh() {
    try { sessionStorage.setItem(BOOT_CACHE_KEY, String(Date.now())); } catch (e) {}
  }

  // Usado pelo aviso "Há atualizações disponíveis" (ver assets/js/
  // layout.js/live-sync mais abaixo): ao clicar em "Atualizar", limpa esta
  // marca antes de recarregar a página, para garantir que o próximo boot
  // busque fresco do servidor de novo, mesmo que os 20s da janela acima
  // ainda não tenham passado.
  function clearBootCacheFresh() {
    try { sessionStorage.removeItem(BOOT_CACHE_KEY); } catch (e) {}
  }

  // ---------------------------------------------------------------
  // Espelho local (localStorage): reserva de leitura rápida/recente,
  // não a fonte de verdade — o Supabase é quem manda.
  // ---------------------------------------------------------------
  function loadLocalMirror() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error("Erro ao ler cópia local dos dados", e);
    }
    return null;
  }

  // Tira das fotos (employees/clients.photoDataUrl) e dos anexos
  // (transactions/occurrences/commissionPayouts.attachment.dataUrl) o
  // base64 antes de gravar a cópia de reserva no localStorage — só nessa
  // cópia, o `_cache` em memória usado pela tela continua com tudo. Esses
  // campos, em base64, são o que mais rápido enche a cota de localStorage
  // do navegador (5-10MB típico) e travariam a gravação da cópia local
  // inteira. Usado só como reserva de segurança quando o IndexedDB (ver
  // abaixo, com cota bem maior e sem essa limitação) não está disponível
  // — o Supabase é a fonte de verdade em qualquer um dos dois casos.
  function stripLargeFieldsForMirror(db) {
    var out = {};
    Object.keys(db).forEach(function (table) {
      var val = db[table];
      if (!Array.isArray(val)) { out[table] = val; return; }
      out[table] = val.map(function (rec) {
        if (!rec || typeof rec !== "object") return rec;
        var hasPhoto = !!rec.photoDataUrl;
        var hasAttachment = !!(rec.attachment && rec.attachment.dataUrl);
        if (!hasPhoto && !hasAttachment) return rec;
        var clone = Object.assign({}, rec);
        if (hasPhoto) clone.photoDataUrl = null;
        if (hasAttachment) clone.attachment = Object.assign({}, clone.attachment, { dataUrl: null });
        return clone;
      });
    });
    return out;
  }

  // ---------------------------------------------------------------
  // IndexedDB — cópia local de reserva COMPLETA, fotos/anexos incluídos.
  // A cota do localStorage costuma travar perto de 5-10MB, enquanto o
  // IndexedDB tem uma cota muito maior (na prática, uma fatia grande do
  // espaço livre em disco) — dá para guardar a base local inteira sem
  // precisar tirar nada dela. Se o IndexedDB não estiver disponível por
  // algum motivo, cai de volta para o localStorage enxuto (sem fotos/
  // anexos) como reserva de segurança.
  //
  // Formato: uma chave por TABELA (em vez de um único blob "db_mirror"
  // com as 22 tabelas juntas, como era antes). Assim, uma escrita comum
  // (ex.: marcar uma conta como paga) só precisa serializar e regravar a
  // tabela que de fato mudou (ex.: só "transactions"), em vez do banco
  // inteiro — antes, cada escrita reserializava as 22 tabelas completas
  // (incluindo fotos/anexos em base64), o que ia ficando cada vez mais
  // lento conforme os dados cresciam, mesmo a alteração sendo pequena.
  // ---------------------------------------------------------------
  var IDB_NAME = "salaoErpIDB_v1";
  var IDB_STORE = "kv";
  // Chave do formato antigo (um único blob com todas as tabelas) — mantida
  // só para migração: navegadores que já tinham essa cópia salva antes
  // desta atualização continuam abrindo com os dados certos (ver
  // idbGetMirror abaixo), até a próxima sincronização completa com o
  // Supabase regravar tudo no formato novo, por tabela.
  var IDB_LEGACY_KEY = "db_mirror";

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error("IndexedDB indisponível neste navegador")); return; }
      var req = global.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // Lê todas as tabelas (uma chave por tabela) numa única transação e monta
  // de volta o objeto { employees: [...], clients: [...], ... }. Também lê
  // a chave antiga (IDB_LEGACY_KEY) e usa ela só para PREENCHER tabelas que
  // ainda não têm uma chave própria — cobre o período de transição logo
  // após esta atualização, antes da primeira sincronização completa com o
  // Supabase regravar tudo no formato novo (ver comentário acima).
  function idbGetMirror() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readonly");
          var store = tx.objectStore(IDB_STORE);
          var result = {};
          var anyFound = false;
          var pending = TABLES.length + 1; // +1 para a chave legada

          function done() {
            pending--;
            if (pending === 0) resolve(anyFound ? result : null);
          }

          TABLES.forEach(function (t) {
            var req = store.get(t);
            req.onsuccess = function () {
              if (req.result !== undefined) { result[t] = req.result; anyFound = true; }
              done();
            };
            req.onerror = function () { done(); };
          });

          var legacyReq = store.get(IDB_LEGACY_KEY);
          legacyReq.onsuccess = function () {
            if (legacyReq.result) {
              Object.keys(legacyReq.result).forEach(function (t) {
                if (!(t in result)) { result[t] = legacyReq.result[t]; anyFound = true; }
              });
            }
            done();
          };
          legacyReq.onerror = function () { done(); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  // Grava uma ou mais tabelas (map: { nomeTabela: valor }) numa única
  // transação — usado tanto para uma escrita normal (uma tabela só) quanto
  // para a sincronização completa após o boot (todas as tabelas de uma vez,
  // ainda assim em UMA transação em vez de 22 separadas).
  function idbSetTables(map) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, "readwrite");
          var store = tx.objectStore(IDB_STORE);
          Object.keys(map).forEach(function (t) { store.put(map[t], t); });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  // Remove a chave do formato antigo depois que a primeira sincronização
  // completa no formato novo já aconteceu — não é essencial (a chave antiga
  // não atrapalha nada ficando parada ali), só evita guardar os dados
  // duplicados indefinidamente. "Fire and forget", sem tratamento de erro:
  // se falhar, não é grave, só significa que a chave antiga fica um pouco
  // mais até a próxima tentativa.
  function idbDeleteLegacy() {
    idbOpen().then(function (db) {
      try {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(IDB_LEGACY_KEY);
      } catch (e) {}
    }).catch(function () {});
  }

  // Guarda no IndexedDB só a(s) tabela(s) que mudaram (fire and forget: a
  // tela já foi atualizada pelo cache em memória, isso aqui é só a reserva
  // para o caso de a internet cair no meio do uso). "tables" pode ser o
  // nome de uma tabela ou uma lista de nomes.
  function persistLocalMirror(tables) {
    var list = Array.isArray(tables) ? tables : [tables];
    var map = {};
    list.forEach(function (t) { map[t] = _cache[t]; });
    idbSetTables(map).catch(function (e) {
      console.error("Erro ao salvar cópia local (IndexedDB) dos dados — tentando reserva enxuta no localStorage", e);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripLargeFieldsForMirror(_cache)));
      } catch (e2) {
        console.error("Erro ao salvar cópia local (localStorage) dos dados", e2);
        // Nenhuma das duas reservas locais funcionou — mas o Supabase já
        // tem os dados (remoteUpsert roda à parte, na hora da escrita),
        // então não vale interromper quem está trabalhando com um alerta
        // vermelho por causa só da cópia de reserva.
      }
    });
  }

  var _batchDepth = 0;
  var _batchDirty = null; // durante um DB.batch(), acumula quais tabelas mudaram (mapa nome->true)

  // "tables": nome de uma tabela ou lista de nomes que mudaram nesta
  // escrita. Fora de um DB.batch(), grava na hora só essas tabelas no
  // IndexedDB. Dentro de um DB.batch(), só acumula os nomes — a gravação de
  // verdade (uma só, com todas as tabelas tocadas no batch) acontece quando
  // o batch mais externo termina (ver DB.batch abaixo).
  function persist(tables) {
    if (!tables) return;
    if (_batchDepth > 0) {
      (Array.isArray(tables) ? tables : [tables]).forEach(function (t) { _batchDirty[t] = true; });
      return;
    }
    persistLocalMirror(tables);
  }

  function fillMissingTables(db) {
    TABLES.forEach(function (t) { if (!db[t]) db[t] = t === "settings" ? {} : []; });
    return db;
  }

  // ---------------------------------------------------------------
  // Busca tudo do Supabase e popula o cache em memória.
  //
  // Três tabelas guardam anexos (comprovante de pagamento, atestado etc.)
  // como um data URL em base64 dentro do próprio registro
  // (`attachment.dataUrl`) — um anexo de poucos MB já é suficiente para
  // inflar essas tabelas a vários MB de JSON. Como o boot busca as 21
  // tabelas inteiras a cada troca de tela (fora da janela de 20s do cache
  // — ver BOOT_CACHE_TTL_MS acima), isso sozinho já foi medido deixando
  // essa busca vários segundos mais lenta assim que a primeira leva de
  // comprovantes reais foi anexada. Por isso, para essas 3 tabelas, o boot
  // busca de uma VIEW no Supabase (ex.: "transactions_boot") que devolve
  // o mesmo registro só que sem o campo `attachment.dataUrl` — o resto do
  // registro (inclusive nome/tipo/tamanho do anexo) continua igual, só o
  // conteúdo binário pesado fica de fora. Quando alguém realmente precisa
  // ver o anexo (abrir o comprovante), busca-se ele à parte, na hora, com
  // getAttachmentFull() (mais abaixo) — direto da tabela real.
  // IMPORTANTE: como consequência, o `_cache` em memória nunca tem o
  // dataUrl completo dessas tabelas — ver o comentário em remoteUpsert()
  // sobre como isso é levado em conta para nunca sobrescrever/apagar um
  // anexo já salvo no servidor numa gravação comum (ex.: marcar uma conta
  // como paga), e o comentário em exportJSON() sobre como o backup
  // continua saindo completo.
  var BOOT_VIEW = {
    transactions: "transactions_boot",
    occurrences: "occurrences_boot",
    commissionPayouts: "commissionPayouts_boot"
  };

  var _readyResolve;
  var readyPromise = new Promise(function (resolve) { _readyResolve = resolve; });

  function rowsToTableData(table, rows) {
    if (table === "settings") return rows.length ? rows[0].data : {};
    return rows.map(function (r) { return r.data; });
  }

  // O Supabase/PostgREST limita cada resposta a no máximo 1000 linhas por
  // padrão. Tabelas como "appointments" já passam disso (ex.: histórico
  // migrado + agendamentos novos), então uma busca sem paginação simplesmente
  // vinha truncada — faltavam registros no cache local sem nenhum aviso.
  // Esta função busca todas as páginas (1000 em 1000) até a última vir
  // incompleta, e só então considera que pegou tudo.
  var FETCH_PAGE_SIZE = 1000;
  function fetchAllRows(src) {
    return new Promise(function (resolve, reject) {
      var acc = [];
      function fetchPage(offset) {
        supa.from(src).select("data").range(offset, offset + FETCH_PAGE_SIZE - 1).then(function (res) {
          if (res.error) { reject(res.error); return; }
          var rows = res.data || [];
          acc = acc.concat(rows);
          if (rows.length < FETCH_PAGE_SIZE) resolve(acc);
          else fetchPage(offset + FETCH_PAGE_SIZE);
        }).catch(reject);
      }
      fetchPage(0);
    });
  }

  function bootstrapOnline() {
    // Cópia local de reserva: tenta o IndexedDB (cota grande, guarda tudo
    // incluindo fotos/anexos); se não achar nada lá, cai para a reserva
    // antiga e enxuta que possa existir no localStorage. Isso só é usado
    // como ponto de partida — nada é desenhado na tela antes de DB.ready,
    // então esse valor nunca aparece "errado" para quem está usando; ele
    // só importa de verdade se a internet cair antes da busca abaixo
    // terminar (ver o .catch mais adiante).
    idbGetMirror().then(function (idbStored) {
      var stored = idbStored || loadLocalMirror();
      _cache = stored ? fillMissingTables(stored) : emptyDB();

      if (!supa) {
        // Supabase não configurado/indisponível — segue com a última
        // cópia local conhecida (ou uma base vazia) para a tela não ficar
        // travada, mas nada aqui vai sincronizar com o servidor.
        if (global.Toast) {
          global.Toast.show("Sem conexão com o banco de dados — verifique a configuração do sistema.", "danger");
        }
        _readyResolve();
        return;
      }

      // Ver comentário do BOOT_CACHE_KEY acima: pula a busca no Supabase se
      // já temos um espelho completo (IndexedDB) e ele foi atualizado há
      // pouco, nesta mesma aba.
      if (idbStored && (Date.now() - readBootCacheFreshAt()) < BOOT_CACHE_TTL_MS) {
        _readyResolve();
        return;
      }

      var fetches = TABLES.map(function (t) {
        var src = BOOT_VIEW[t] || t;
        return fetchAllRows(src).then(function (rows) {
          return { table: t, rows: rows };
        });
      });

      Promise.all(fetches).then(function (results) {
        var fresh = {};
        results.forEach(function (r) { fresh[r.table] = rowsToTableData(r.table, r.rows); });
        fillMissingTables(fresh);
        // rede de segurança: nunca ficar sem usuário nenhum cadastrado
        if (!fresh.users || !fresh.users.length) fresh.users = emptyDB().users;
        _cache = fresh;
        persistLocalMirror(TABLES);
        idbDeleteLegacy();
        markBootCacheFresh();
        _readyResolve();
      }).catch(function (err) {
        console.error("Falha ao sincronizar com o Supabase — usando a última cópia salva neste aparelho.", err);
        if (global.Toast) {
          global.Toast.show("Sem conexão com o servidor — mostrando a última cópia salva neste aparelho.", "danger");
        }
        _readyResolve();
      });
    });
  }

  bootstrapOnline();

  function load() { return _cache; }

  // ---------------------------------------------------------------
  // "Quase tempo real" (18/09/2026): antes desta correção, uma aba só
  // buscava dados do Supabase UMA VEZ (no boot — ver bootstrapOnline
  // acima) e nunca mais sozinha; mudanças feitas por outra pessoa, em
  // outro aparelho, só apareciam se esta aba fosse recarregada. Numa
  // recepção com várias pessoas usando o sistema ao mesmo tempo (o
  // computador da recepção costuma ficar com uma aba aberta o dia
  // inteiro), isso significa trabalhar com uma "foto" cada vez mais velha
  // da agenda/estoque/financeiro sem perceber.
  //
  // hasRemoteChangesSince faz uma checagem LEVE (só pergunta "existe
  // algum registro atualizado depois de X?" — sem baixar os dados de
  // verdade) em cada tabela; ver assets/js/layout.js, que chama isso
  // periodicamente em toda tela autenticada e mostra um aviso não-
  // intrusivo ("Há atualizações disponíveis") em vez de recarregar
  // sozinho por cima do que a pessoa está fazendo — a decisão de quando
  // atualizar a tela continua sendo de quem está usando o sistema (nunca
  // interrompe um formulário/modal aberto).
  function hasRemoteChangesSince(sinceIso) {
    if (!supa || !sinceIso) return Promise.resolve(false);
    var checks = TABLES.map(function (t) {
      // Consulta a tabela BASE (não a BOOT_VIEW) — só precisamos saber SE
      // mudou algo, não dos dados em si, então o campo pesado de anexo
      // (que a view existe pra evitar) nem entra na consulta.
      return supa.from(t).select("id").gt("updated_at", sinceIso).limit(1).then(function (res) {
        return !res.error && !!(res.data && res.data.length);
      }).catch(function () { return false; });
    });
    return Promise.all(checks).then(function (results) { return results.some(Boolean); });
  }

  // ---------------------------------------------------------------
  // Sincronização em segundo plano com o Supabase.
  // Cada função aqui é "fire and forget": a tela já foi atualizada de
  // forma otimista no cache em memória antes de chamar isso — se a
  // sincronização falhar, avisamos por um toast (sem travar a tela) e
  // a próxima escrita tenta de novo.
  // ---------------------------------------------------------------
  var _warnedRecently = {};
  function remoteFail(table, action, err) {
    console.error("Erro ao " + action + " no Supabase (tabela " + table + ")", err);
    var key = table + ":" + action;
    if (global.Toast && !_warnedRecently[key]) {
      _warnedRecently[key] = true;
      global.Toast.show("Alteração salva neste aparelho, mas houve falha ao sincronizar com o servidor. Verifique sua internet.", "danger");
      setTimeout(function () { _warnedRecently[key] = false; }, 15000);
    }
  }

  // Um registro "leve" é o que veio de uma tabela em BOOT_VIEW (ver
  // bootstrapOnline acima): tem attachment.name/type/size, mas nunca
  // attachment.dataUrl (a chave nem existe no objeto — diferente de um
  // anexo removido de propósito, que vira attachment: null). Detectar
  // esse formato aqui, e não confiar em cada tela lembrar de tratar isso,
  // é o que garante que NENHUMA gravação comum (ex.: marcar uma conta como
  // paga, editar o valor, uma conciliação) apague sem querer um anexo já
  // salvo no servidor só porque o cache em memória não tinha o dataUrl
  // carregado.
  function isLightAttachment(att) {
    return !!(att && typeof att === "object" && !("dataUrl" in att));
  }

  function remoteUpsert(table, record) {
    if (!supa) return;
    if (isLightAttachment(record.attachment)) {
      // Busca o anexo de verdade (com dataUrl) que já está salvo nesse
      // registro no Supabase antes de gravar o resto — assim o registro
      // "leve" que está na memória (sem o dataUrl) nunca sobrescreve/apaga
      // o anexo real. Só acontece para registros que de fato têm anexo
      // (a maioria não tem, e nem entra nesse caminho).
      supa.from(table).select("data").eq("id", record.id).then(function (res) {
        var current = (res.data && res.data[0] && res.data[0].data) || null;
        var merged = Object.assign({}, record, { attachment: (current && current.attachment) || null });
        return supa.from(table).upsert({ id: merged.id, data: merged });
      }).then(function (res) {
        if (res && res.error) remoteFail(table, "salvar", res.error);
      }).catch(function (err) { remoteFail(table, "salvar", err); });
      return;
    }
    supa.from(table).upsert({ id: record.id, data: record }).then(function (res) {
      if (res.error) remoteFail(table, "salvar", res.error);
    }).catch(function (err) { remoteFail(table, "salvar", err); });
  }

  // Busca o anexo completo (com dataUrl) de um único registro direto da
  // tabela real (não da view leve do boot) — usar só quando o usuário
  // realmente precisa ver/baixar o anexo (abrir o comprovante, pré-carregar
  // o preview ao editar), nunca em massa.
  function fetchAttachmentFull(table, id) {
    if (!supa) return Promise.resolve(null);
    return supa.from(table).select("data").eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      var rec = res.data && res.data[0] && res.data[0].data;
      return (rec && rec.attachment) || null;
    }).catch(function (err) {
      console.error("Erro ao buscar anexo completo (tabela " + table + ", id " + id + ")", err);
      return null;
    });
  }

  function remoteDelete(table, id) {
    if (!supa) return;
    supa.from(table).delete().eq("id", id).then(function (res) {
      if (res.error) remoteFail(table, "excluir", res.error);
    }).catch(function (err) { remoteFail(table, "excluir", err); });
  }

  // BUG CORRIGIDO (18/09/2026): usado pelo fluxo de Bater Ponto (ver
  // ponto.js/saveEntry). Relato real de funcionária: "tiramos a foto,
  // enviamos, mas não dá baixa" — acontecia porque DB.insert (como em
  // qualquer tela do sistema) é otimista: grava local na hora e dispara
  // remoteUpsert em segundo plano ("fire and forget" — ver comentário
  // acima de remoteUpsert). Se essa sincronização falhasse (rede instável
  // no tablet/celular da recepção, por exemplo), a tela já tinha mostrado
  // "Ponto registrado!" — a única pista de que algo deu errado era um
  // toast de aviso que aparece alguns segundos DEPOIS (esperando a
  // resposta da rede), quando quem bateu o ponto já tinha devolvido o
  // aparelho e ido embora. Resultado: para quem confere depois (Gestão de
  // Ponto, carregado fresco do servidor), a marcação simplesmente nunca
  // existiu — mesmo a pessoa tendo feito tudo certo.
  //
  // Esta função permite ESPERAR e CONFIRMAR de verdade que o registro
  // chegou no servidor antes de declarar sucesso ao usuário, em vez de
  // confiar cegamente no otimismo local — só para este fluxo (ponto),
  // onde a confirmação na hora é crítica; o resto do sistema continua
  // usando o padrão otimista de sempre (não vale a pena, nem é seguro,
  // fazer toda tela esperar confirmação de rede para cada gravação).
  // Tenta algumas vezes com um pequeno intervalo (tolera uma latência
  // normal de rede sem reportar falha à toa); se todas as tentativas
  // falharem, resolve como false e quem chamou decide o que fazer.
  function confirmRemoteSaved(table, id, attemptsLeft) {
    if (!supa) return Promise.resolve(true); // sem Supabase configurado: nada a confirmar
    attemptsLeft = attemptsLeft == null ? 4 : attemptsLeft;
    return supa.from(table).select("data").eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      if (res.data && res.data.length) return true;
      if (attemptsLeft > 1) {
        return new Promise(function (resolve) { setTimeout(resolve, 900); })
          .then(function () { return confirmRemoteSaved(table, id, attemptsLeft - 1); });
      }
      return false;
    }).catch(function () {
      if (attemptsLeft > 1) {
        return new Promise(function (resolve) { setTimeout(resolve, 900); })
          .then(function () { return confirmRemoteSaved(table, id, attemptsLeft - 1); });
      }
      return false;
    });
  }

  // BUG CORRIGIDO (18/09/2026): mesma família do bug de "settings" (ver
  // remoteMergeSettings abaixo), só que num CAMPO qualquer (array OU
  // número) de um registro qualquer, em vez do blob inteiro de
  // configurações. Achados na auditoria pós-incidente:
  // - assets/js/agenda.js: toda vez que um agendamento consome/cria/libera
  //   uma sessão de Pacote de Tratamento, o código lia `client.packages` do
  //   CACHE LOCAL desta aba (`DB.get`, que nunca consulta o servidor — só o
  //   `_cache` em memória), recalculava o array inteiro trocando/
  //   adicionando um item, e gravava de volta com `DB.update("clients", id,
  //   { packages: newPackages })` — um upsert do registro inteiro. Se outra
  //   aba/recepcionista tivesse mexido nesse MESMO `client.packages`
  //   enquanto esta aba estava com o cliente já carregado (ex.: vendeu um
  //   pacote novo, ou concluiu outra sessão), essa gravação apagava
  //   silenciosamente a mudança da outra pessoa — o mesmo padrão que já
  //   causou "todos os pacotes de tratamento sumiram" uma vez (lá, no blob
  //   de settings; aqui, no array de pacotes comprados de um cliente).
  // - assets/js/estoque.js: "Movimentar Estoque" lia `p.currentStock` só
  //   quando o modal abria e gravava `currentStock: estoqueDoModal + delta`
  //   — se outra movimentação do MESMO produto fosse salva enquanto o modal
  //   estava aberto (ex.: uma entrada de compra e uma saída de venda quase
  //   juntas), a segunda a salvar apagava o efeito da primeira.
  //
  // Esta função resolve de forma genérica (reaproveitável por qualquer
  // tabela/campo, array ou não): busca o registro mais recente do
  // SERVIDOR, aplica a mesma função de transformação (`transformFn`) em
  // cima do valor FRESCO do campo, e grava esse resultado — em vez de
  // confiar no valor já calculado a partir do cache local, que pode estar
  // velho. `transformFn` recebe o valor atual do campo tal como está no
  // servidor (pode ser undefined se o registro nunca teve esse campo) e é
  // responsável por lidar com esse caso — ver DB.mergeFieldUpdate abaixo.
  // REFORÇADO (18/09/2026, mesma varredura): as quatro funções remoteMerge*
  // deste bloco (esta, remoteMergeRecord, remoteMergeSettings e
  // remoteMergeSettingsField) originalmente buscavam o registro mais
  // recente do servidor e gravavam de volta com um upsert "cego". Isso já
  // encurtava MUITO a janela de corrida (de "a aba ficou aberta horas" —
  // o bug original — para só o tempo de uma ida-e-volta de rede), mas não
  // fechava essa janela por completo: uma simulação isolada escrita
  // durante esta varredura reproduziu um caso real onde DUAS gravações
  // concorrentes liam o mesmo valor ANTES de qualquer uma delas gravar
  // (ex.: um desconto direto em Estoque e uma aprovação de desconto quase
  // juntos) — nesse caso, a que gravasse por último ainda podia apagar a
  // outra. Por isso, todas as quatro agora passam por casMergeWrite logo
  // abaixo, que fecha essa janela de vez com "compare-and-swap": só grava
  // se ninguém mais tiver gravado nesse registro desde que os dados foram
  // buscados (usando o próprio updated_at, mantido automaticamente pela
  // trigger set_updated_at já existente no schema); se alguém gravou no
  // meio, busca de novo, do zero, e tenta de novo — em vez de gravar por
  // cima cegamente ou desistir.
  function casMergeWrite(table, id, computePatch, attemptsLeft) {
    if (!supa) return Promise.resolve();
    attemptsLeft = attemptsLeft == null ? 6 : attemptsLeft;
    return supa.from(table).select("data, updated_at").eq("id", id).then(function (res) {
      if (res.error) throw res.error;
      var row = res.data && res.data[0];
      if (!row) return null; // registro ainda não existe no servidor — nada a mesclar aqui
      var server = row.data;
      var patch = computePatch(server);
      if (patch == null) return null; // computePatch pode sinalizar "nada a gravar"
      var merged = Object.assign({}, server, patch);
      return supa.from(table).update({ data: merged }).eq("id", id).eq("updated_at", row.updated_at).select("id").then(function (upd) {
        if (upd.error) throw upd.error;
        if (upd.data && upd.data.length) return true; // gravou — ninguém mais mexeu nesse meio tempo
        // updated_at já não bate mais com o que buscamos: outra gravação
        // aconteceu bem no meio. Busca de novo (dados frescos de verdade)
        // e tenta de novo, em vez de gravar cego por cima ou desistir.
        if (attemptsLeft > 1) {
          return casMergeWrite(table, id, computePatch, attemptsLeft - 1);
        }
        throw new Error("Não foi possível gravar sem sobrepor uma alteração concorrente, mesmo após várias tentativas");
      });
    }).catch(function (err) { remoteFail(table, "salvar", err); });
  }

  function remoteMergeField(table, id, field, transformFn) {
    casMergeWrite(table, id, function (server) {
      var patch = {};
      patch[field] = transformFn(server[field]);
      return patch;
    });
  }

  // BUG CORRIGIDO (18/09/2026, varredura de "múltiplos usuários em tempo
  // real"): irmã de remoteMergeField, para quando é preciso recalcular
  // VÁRIOS campos interdependentes de uma vez (não dá pra tratar cada
  // campo isoladamente porque um depende do outro — ex.: em
  // productConsumptions, `totalCost`, `employeeShare` e `companyShare`
  // são recalculados juntos a partir de `discountApplied`). Mesma ideia de
  // remoteMergeField: busca o registro mais recente do SERVIDOR e aplica
  // `transformFn` em cima DELE (não do cache local, que pode estar velho).
  // `transformFn` recebe o registro fresco (como está no servidor) e
  // devolve um OBJETO PATCH (só os campos que mudam) — nunca o registro
  // inteiro, para não arriscar apagar um campo que `transformFn` não
  // conhece (ex.: attachment.dataUrl de uma tabela BOOT_VIEW).
  function remoteMergeRecord(table, id, transformFn) {
    casMergeWrite(table, id, function (server) { return transformFn(server) || {}; });
  }

  // Apaga tudo de uma tabela no Supabase e regrava com a lista atual —
  // usado por setTable/importJSON, que já substituem a tabela inteira de
  // uma vez no cache local.
  function remoteReplaceAll(table, records) {
    if (!supa) return;
    supa.from(table).delete().neq("id", "__none__").then(function (delRes) {
      if (delRes.error) throw delRes.error;
      if (!records || !records.length) return { error: null };
      var rows = records.map(function (r) { return { id: r.id, data: r }; });
      return supa.from(table).upsert(rows);
    }).then(function (res) {
      if (res && res.error) throw res.error;
    }).catch(function (err) { remoteFail(table, "sincronizar", err); });
  }

  // Substitui o registro "settings" inteiro no Supabase pelo objeto
  // informado — uso deliberado: só para importJSON (restaurar um backup é
  // "que fique exatamente assim", inclusive apagando o que não estiver no
  // arquivo). Para qualquer alteração incremental (editar um Cargo, uma
  // Forma de Pagamento, um Pacote de Tratamento, um Grupo de Acesso etc.),
  // usar remoteMergeSettings abaixo — NUNCA esta função, ver o comentário
  // dela para o motivo.
  function remoteReplaceSettings(settingsObj) {
    if (!supa) return;
    supa.from("settings").delete().neq("id", "__none__").then(function (delRes) {
      if (delRes.error) throw delRes.error;
      return supa.from("settings").upsert({ id: "settings", data: settingsObj });
    }).then(function (res) {
      if (res && res.error) throw res.error;
    }).catch(function (err) { remoteFail("settings", "sincronizar", err); });
  }

  // BUG CRÍTICO CORRIGIDO (18/09/2026): todo o conteúdo de Configurações
  // que não tem tabela própria no Supabase (Cargos, Formas de Pagamento,
  // Pacotes de Tratamento, Grupos de Acesso, nome da empresa, config. de
  // e-mail — tudo dentro de um único registro "settings") era gravado
  // assim: cada alteração incremental (ex.: editar um Cargo) pegava o
  // `db.settings` da MEMÓRIA desta aba, mesclava só o campo mudado nele, e
  // gravava esse objeto INTEIRO no servidor por cima de tudo que já
  // estivesse lá (remoteReplaceSettings acima). Numa aba aberta há um
  // tempo (ex.: recepção, ligada o dia todo), esse `db.settings` em memória
  // fica desatualizado assim que QUALQUER outra pessoa, em outra aba, salva
  // qualquer outra coisa em Configurações — e a próxima gravação feita
  // nesta aba antiga sobrescreve o servidor com a versão velha, apagando
  // silenciosamente o que a outra pessoa tinha acabado de salvar. Foi assim
  // que "todos os cadastros de pacotes de serviço sumiram" (relatado pelo
  // usuário): alguém, numa aba com o settings desatualizado (sem os
  // pacotes que tinham acabado de ser cadastrados em outra aba), salvou uma
  // alteração incremental sem relação nenhuma com Pacotes (um Cargo, uma
  // Forma de Pagamento, um Grupo de Acesso...) e isso apagou os pacotes no
  // servidor sem ninguém perceber na hora.
  //
  // Correção: em vez de mesclar o patch em cima do settings desta aba (que
  // pode estar velho) e gravar isso por cima de tudo, busca-se o settings
  // MAIS RECENTE direto do servidor, mescla-se o patch em cima DELE, e só
  // então grava — assim uma alteração incremental nunca apaga um campo que
  // outra pessoa salvou depois que esta aba carregou os dados. Ainda existe
  // uma janela de corrida mínima (entre essa busca e essa gravação, poucos
  // milissegundos), mas ela é de rede, não mais de "a aba ficou horas
  // aberta" — no volume de uso desta equipe, isso já resolve o problema.
  function remoteMergeSettings(patch) {
    casMergeWrite("settings", "settings", function () { return patch; });
  }

  // BUG CRÍTICO CORRIGIDO (18/09/2026): mesma família do bug de settings
  // acima, só que num CAMPO ESPECÍFICO que guarda uma LISTA (Cargos,
  // Formas de Pagamento, Pacotes de Tratamento, Grupos de Acesso...).
  // remoteMergeSettings (acima) já evita que uma alteração incremental
  // apague OUTROS campos de settings (ex.: editar um Cargo não apaga mais
  // os Pacotes) — mas isso não protege duas pessoas editando a MESMA
  // lista ao mesmo tempo: cada tela (ver configuracoes.js) lia a lista
  // inteira do cache local, guardava em memória enquanto o usuário
  // preenchia o formulário (às vezes minutos), e ao salvar recalculava a
  // lista INTEIRA (map/concat/filter) a partir dessa cópia — se outra
  // pessoa tivesse criado/editado/removido um item dessa mesma lista
  // nesse meio tempo, a gravação seguinte apagava essa mudança
  // silenciosamente (exatamente o mesmo tipo de incidente de "todos os
  // pacotes sumiram", só que ainda não corrigido nessas 4 telas
  // específicas). Resolve como remoteMergeField: busca o valor FRESCO do
  // campo direto do servidor, aplica `transformFn` em cima dele, grava.
  function remoteMergeSettingsField(field, transformFn) {
    casMergeWrite("settings", "settings", function (server) {
      var patch = {};
      patch[field] = transformFn(server[field]);
      return patch;
    });
  }

  var DB = {
    TABLES: TABLES,

    // Promise que resolve quando o cache em memória está pronto para uso
    // (depois da primeira busca no Supabase). Toda página deve aguardar
    // DB.ready antes de chamar qualquer outra função do DB.
    ready: readyPromise,

    all: function (table) {
      var db = load();
      return db[table] ? db[table].slice() : [];
    },

    get: function (table, id) {
      var db = load();
      return (db[table] || []).find(function (r) { return r.id === id; }) || null;
    },

    find: function (table, predicate) {
      return this.all(table).filter(predicate);
    },

    findOne: function (table, predicate) {
      return this.all(table).find(predicate) || null;
    },

    insert: function (table, record) {
      var db = load();
      if (!record.id) record.id = uid(table.slice(0, 3));
      record.createdAt = record.createdAt || nowISO();
      record.updatedAt = nowISO();
      db[table].push(record);
      persist(table);
      remoteUpsert(table, record);
      return record;
    },

    // Confirma se um registro já inserido/atualizado (via insert/update)
    // realmente chegou no servidor — ver o comentário de confirmRemoteSaved
    // acima. Retorna uma Promise<boolean>. Usar só onde a confirmação
    // imediata for importante (ex.: Bater Ponto); no resto do sistema, o
    // padrão continua sendo otimista (não chamar isto à toa).
    confirmSaved: function (table, id) {
      return confirmRemoteSaved(table, id);
    },

    // Verdadeiro quando há um Supabase configurado e conectado nesta
    // sessão. Usado para decidir se vale a pena esperar/confirmar uma
    // sincronização remota (ex.: conciliação em par — ver
    // conciliacao.js/maquininhas-conciliacao.js) ou se, sem servidor
    // configurado, é melhor simplesmente confiar no cache local como o
    // resto do sistema já faz.
    hasRemote: function () { return !!supa; },

    // Timestamp (ISO) de quando o cache desta aba foi buscado fresco do
    // servidor pela última vez de verdade (não só reaproveitado da janela
    // de 20s entre navegações — ver BOOT_CACHE_KEY acima). Usado como
    // "watermark" pelo aviso de "Há atualizações disponíveis" (ver
    // assets/js/layout.js) para perguntar ao servidor "mudou algo desde
    // então?".
    syncedAt: function () {
      var ms = readBootCacheFreshAt();
      return ms ? new Date(ms).toISOString() : nowISO();
    },

    // Ver hasRemoteChangesSince acima.
    hasRemoteChangesSince: function (sinceIso) { return hasRemoteChangesSince(sinceIso); },

    // Ver clearBootCacheFresh acima — usado antes de recarregar a página
    // a partir do aviso "Há atualizações disponíveis", para garantir um
    // boot fresco de verdade.
    clearBootCache: function () { clearBootCacheFresh(); },

    // Busca um registro direto do SERVIDOR (não do cache local desta aba),
    // como Promise. Usado quando é preciso confirmar o estado mais recente
    // de verdade antes de agir — ex.: Approvals.approve/reject, para não
    // aplicar duas vezes a mesma solicitação se dois aprovadores clicarem
    // quase juntos em abas/dispositivos diferentes (ver approvals.js).
    // Resolve como null se não houver Supabase configurado, se o registro
    // não existir, ou se a busca falhar (rede) — quem chamou decide como
    // tratar "não deu para confirmar" (normalmente: seguir em frente,
    // tolerante, como o resto do sistema já faz).
    fetchFresh: function (table, id) {
      if (!supa) return Promise.resolve(null);
      return supa.from(table).select("data").eq("id", id).then(function (res) {
        if (res.error) throw res.error;
        return (res.data && res.data[0] && res.data[0].data) || null;
      }).catch(function () { return null; });
    },

    // Força uma nova tentativa de sincronização remota de um registro já
    // existente no cache local, sem alterar nenhum campo (só "toca" o
    // registro) — usado pelo botão "Tentar Novamente" do fluxo de Ponto
    // quando a confirmação acima falha, para reenviar sem duplicar.
    retrySync: function (table, id) {
      var db = load();
      var rec = (db[table] || []).find(function (r) { return r.id === id; });
      if (rec) remoteUpsert(table, rec);
    },

    // Atualiza UM campo de um registro (array ou número) de forma segura
    // contra corrida entre abas — ver o comentário de remoteMergeField
    // acima. Usar em vez de DB.update() sempre que o patch for calculado a
    // partir do valor ATUAL de um campo que outras pessoas também podem
    // editar ao mesmo tempo neste mesmo registro (ex.: client.packages,
    // product.currentStock). `transformFn` recebe o valor atual do campo
    // (do jeito que está no cache local, ou undefined se nunca existiu) e
    // devolve o novo valor; roda uma vez em cima do cache local (para a
    // tela responder na hora) e de novo, em segundo plano, em cima do
    // valor mais recente do SERVIDOR (para a gravação de verdade nunca
    // apagar uma mudança concorrente nesse campo).
    mergeFieldUpdate: function (table, id, field, transformFn) {
      var db = load();
      var idx = (db[table] || []).findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      var patch = {};
      patch[field] = transformFn(db[table][idx][field]);
      db[table][idx] = Object.assign({}, db[table][idx], patch, { updatedAt: nowISO() });
      persist(table);
      remoteMergeField(table, id, field, transformFn);
      return db[table][idx];
    },

    // Igual a mergeFieldUpdate, mas para quando VÁRIOS campos do mesmo
    // registro precisam ser recalculados juntos (interdependentes) em vez
    // de um só — ver o comentário de remoteMergeRecord acima. `transformFn`
    // recebe o registro atual (local na primeira passada, fresco do
    // servidor na sincronização em segundo plano) e devolve só o PATCH
    // (objeto com os campos que mudam), nunca o registro inteiro.
    mergeRecordUpdate: function (table, id, transformFn) {
      var db = load();
      var idx = (db[table] || []).findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      var patch = transformFn(db[table][idx]) || {};
      db[table][idx] = Object.assign({}, db[table][idx], patch, { updatedAt: nowISO() });
      persist(table);
      remoteMergeRecord(table, id, transformFn);
      return db[table][idx];
    },

    // Igual a mergeFieldUpdate, mas para um campo DENTRO de settings (que
    // é um único registro compartilhado por tudo em Configurações que não
    // tem tabela própria) — ver o comentário de remoteMergeSettingsField
    // acima. Usar em vez de updateSettings/saveRoles/savePaymentMethods/
    // saveTreatmentPackages/saveAccessGroups sempre que o novo valor for
    // uma lista RECALCULADA (map/concat/filter) a partir da lista já
    // existente, em vez de um valor totalmente novo e independente.
    mergeSettingsField: function (field, transformFn) {
      var db = load();
      var patch = {};
      patch[field] = transformFn(db.settings ? db.settings[field] : undefined);
      db.settings = Object.assign({}, db.settings, patch);
      persist("settings");
      remoteMergeSettingsField(field, transformFn);
      return db.settings;
    },

    insertMany: function (table, records) {
      var db = load();
      records.forEach(function (r) {
        if (!r.id) r.id = uid(table.slice(0, 3));
        r.createdAt = r.createdAt || nowISO();
        r.updatedAt = nowISO();
      });
      db[table] = db[table].concat(records);
      persist(table);
      records.forEach(function (r) { remoteUpsert(table, r); });
      return records;
    },

    update: function (table, id, patch) {
      var db = load();
      var idx = (db[table] || []).findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      db[table][idx] = Object.assign({}, db[table][idx], patch, { updatedAt: nowISO() });
      persist(table);
      remoteUpsert(table, db[table][idx]);
      return db[table][idx];
    },

    remove: function (table, id) {
      var db = load();
      var before = db[table].length;
      db[table] = db[table].filter(function (r) { return r.id !== id; });
      persist(table);
      var removed = db[table].length < before;
      if (removed) remoteDelete(table, id);
      return removed;
    },

    removeWhere: function (table, predicate) {
      var db = load();
      var toRemove = db[table].filter(predicate);
      db[table] = db[table].filter(function (r) { return !predicate(r); });
      persist(table);
      toRemove.forEach(function (r) { remoteDelete(table, r.id); });
    },

    setTable: function (table, records) {
      var db = load();
      var ts = nowISO();
      if (Array.isArray(records)) {
        records.forEach(function (r) {
          if (r && typeof r === "object") {
            if (!r.createdAt) r.createdAt = ts;
            if (!r.updatedAt) r.updatedAt = ts;
          }
        });
      }
      db[table] = records;
      persist(table);
      if (table === "settings") remoteReplaceSettings(records);
      else remoteReplaceAll(table, records);
    },

    getSettings: function () { return load().settings || {}; },
    updateSettings: function (patch) {
      var db = load();
      db.settings = Object.assign({}, db.settings, patch);
      persist("settings");
      remoteMergeSettings(patch);
      return db.settings;
    },

    // Cargos (ver DEFAULT_ROLES acima). Na primeira leitura, se ainda não
    // existir nenhum cargo salvo (sistemas já em produção antes desse
    // recurso existir), semeia a lista com os mesmos nomes que já estavam
    // fixos no código — para não deixar nenhum funcionário já cadastrado
    // com um cargo "orfão" — mais o novo cargo "Assistente".
    getRoles: function () {
      var db = load();
      var current = (db.settings && db.settings.roles) || [];
      if (!current.length) {
        current = DEFAULT_ROLES.slice();
        db.settings = Object.assign({}, db.settings, { roles: current });
        persist("settings");
        remoteMergeSettings({ roles: current });
      }
      return current;
    },
    saveRoles: function (list) {
      var db = load();
      db.settings = Object.assign({}, db.settings, { roles: list });
      persist("settings");
      remoteMergeSettings({ roles: list });
      return db.settings.roles;
    },

    // Formas de pagamento (ver DEFAULT_PAYMENT_METHODS acima). Mesma ideia
    // de getRoles: semeia na primeira leitura para sistemas já em produção
    // (para não deixar nenhum lançamento antigo "órfão" de forma de
    // pagamento) — o app.js/agenda.js hoje já usava esses mesmos 4 nomes
    // fixos, mais o novo "Parceria".
    //
    // 09/09/2026: sistemas que já tinham Formas de Pagamento configuradas
    // ANTES de "Pacote" existir (o `!current.length` acima só semeia numa
    // lista vazia) precisam ganhar a forma nova automaticamente também, sem
    // exigir um cadastro manual em Configurações — daí o segundo `if`
    // abaixo, uma migração incremental idempotente (o `some()` garante que
    // só roda até a forma "Pacote" passar a existir na lista salva).
    getPaymentMethods: function () {
      var db = load();
      var current = (db.settings && db.settings.paymentMethods) || [];
      var changed = false;
      if (!current.length) {
        current = DEFAULT_PAYMENT_METHODS.slice();
        changed = true;
      } else if (!current.some(function (p) { return p.isPackage; })) {
        current = current.concat([{ id: "pmt_pacote", name: "Pacote", isParceria: false, isPackage: true }]);
        changed = true;
      }
      if (changed) {
        db.settings = Object.assign({}, db.settings, { paymentMethods: current });
        persist("settings");
        remoteMergeSettings({ paymentMethods: current });
      }
      return current;
    },
    savePaymentMethods: function (list) {
      var db = load();
      db.settings = Object.assign({}, db.settings, { paymentMethods: list });
      persist("settings");
      remoteMergeSettings({ paymentMethods: list });
      return db.settings.paymentMethods;
    },

    // Pacotes de tratamento (4 sessões, valor por tamanho de cabelo).
    // Mesma ideia de getPaymentMethods, mas sem lista padrão/seed — é um
    // cadastro novo, começa vazio até o usuário criar o primeiro pacote.
    getTreatmentPackages: function () {
      var db = load();
      return (db.settings && db.settings.treatmentPackages) || [];
    },
    saveTreatmentPackages: function (list) {
      var db = load();
      db.settings = Object.assign({}, db.settings, { treatmentPackages: list });
      persist("settings");
      remoteMergeSettings({ treatmentPackages: list });
      return db.settings.treatmentPackages;
    },

    // Async (devolve uma Promise<string>) — diferente das outras funções
    // do DB, que são todas síncronas (lêem do cache em memória). Precisa
    // ser assim porque o cache em memória guarda, de propósito, uma versão
    // sem o dataUrl dos anexos das tabelas em BOOT_VIEW (ver o comentário
    // lá em cima) — um backup com anexo "quebrado" (sem o arquivo de
    // verdade) não serviria pra nada, então essa função busca essas
    // tabelas de novo, completas, direto do Supabase, só na hora de gerar
    // o arquivo de backup (uma ação rara e explícita do usuário — não faz
    // parte da navegação normal entre telas).
    exportJSON: function () {
      var snapshot = load();
      var lightTables = Object.keys(BOOT_VIEW);
      if (!supa) return Promise.resolve(JSON.stringify(snapshot, null, 2));
      var fetches = lightTables.map(function (t) {
        return fetchAllRows(t).then(function (rows) {
          return { table: t, rows: rows };
        }).catch(function (err) {
          console.error("Erro ao buscar dados completos de \"" + t + "\" para o backup — o backup vai sair sem os anexos dessa tabela.", err);
          return { table: t, rows: null };
        });
      });
      return Promise.all(fetches).then(function (results) {
        var full = Object.assign({}, snapshot);
        results.forEach(function (r) {
          if (r.rows) full[r.table] = rowsToTableData(r.table, r.rows);
        });
        return JSON.stringify(full, null, 2);
      });
    },

    // Busca o anexo completo (com dataUrl) de um único registro — usar
    // quando o usuário pede pra ver/baixar um comprovante/anexo específico,
    // ou para pré-carregar o preview correto ao abrir um cadastro para
    // editar. Devolve uma Promise (null se não houver anexo ou a busca
    // falhar).
    getAttachmentFull: function (table, id) {
      return fetchAttachmentFull(table, id);
    },

    importJSON: function (jsonStr) {
      var parsed = JSON.parse(jsonStr);
      _cache = fillMissingTables(parsed);
      persist(TABLES);
      TABLES.forEach(function (t) {
        if (t === "settings") remoteReplaceSettings(_cache.settings);
        else remoteReplaceAll(t, _cache[t]);
      });
    },

    // Groups many insert/update/remove calls into a single localStorage write.
    // Use for any loop that mutates several records at once (bulk matching,
    // bulk import, etc.) — without it, each call inside the loop would
    // re-serialize the whole cópia local a cada iteração, o que fica lento
    // com tabelas de alguns milhares de linhas. As chamadas ao Supabase de
    // cada operação continuam acontecendo normalmente, uma a uma.
    batch: function (fn) {
      var isOutermost = _batchDepth === 0;
      if (isOutermost) _batchDirty = {};
      _batchDepth++;
      try {
        fn();
      } finally {
        _batchDepth--;
        if (_batchDepth === 0) {
          var dirty = Object.keys(_batchDirty);
          _batchDirty = null;
          if (dirty.length) persistLocalMirror(dirty);
        }
      }
    },

    // Records an entry in the activity log (auditoria). Keeps only the most
    // recent MAX_LOG_ENTRIES to avoid unbounded growth.
    log: function (action, description, extra) {
      var db = load();
      var entry = Object.assign({
        id: uid("log"),
        timestamp: nowISO(),
        action: action || "Ação",
        description: description || "",
        userName: (global.CurrentUser && global.CurrentUser.get && global.CurrentUser.get())
          ? (global.CurrentUser.get().firstName + " " + global.CurrentUser.get().lastName)
          : "Administrador"
      }, extra || {});
      db.activityLog.push(entry);
      var MAX_LOG_ENTRIES = 2000;
      var overflow = db.activityLog.length - MAX_LOG_ENTRIES;
      if (overflow > 0) {
        var removed = db.activityLog.slice(0, overflow);
        db.activityLog = db.activityLog.slice(overflow);
        removed.forEach(function (r) { remoteDelete("activityLog", r.id); });
      }
      persist("activityLog");
      remoteUpsert("activityLog", entry);
      return entry;
    },

    uid: uid,
    nowISO: nowISO
  };

  global.DB = DB;
})(window);
