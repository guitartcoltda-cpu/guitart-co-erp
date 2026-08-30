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
        return supa.from(src).select("data").then(function (res) {
          if (res.error) throw res.error;
          return { table: t, rows: res.data || [] };
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

  function remoteReplaceSettings(settingsObj) {
    if (!supa) return;
    supa.from("settings").delete().neq("id", "__none__").then(function (delRes) {
      if (delRes.error) throw delRes.error;
      return supa.from("settings").upsert({ id: "settings", data: settingsObj });
    }).then(function (res) {
      if (res && res.error) throw res.error;
    }).catch(function (err) { remoteFail("settings", "sincronizar", err); });
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
      remoteReplaceSettings(db.settings);
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
        remoteReplaceSettings(db.settings);
      }
      return current;
    },
    saveRoles: function (list) {
      var db = load();
      db.settings = Object.assign({}, db.settings, { roles: list });
      persist("settings");
      remoteReplaceSettings(db.settings);
      return db.settings.roles;
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
        return supa.from(t).select("data").then(function (res) {
          if (res.error) throw res.error;
          return { table: t, rows: res.data || [] };
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
