/* ============================================================
   Salão ERP — Camada de dados (DB)
   Dois modos, escolhidos automaticamente pela presença (ou não) de
   window.ENV.SUPABASE_URL / SUPABASE_ANON_KEY (ver assets/js/env-config.js):

   - MODO OFFLINE (sem config do Supabase): comportamento original,
     100% localStorage, usado pela versão baixada em zip / uso local.
   - MODO ONLINE (com config do Supabase): os dados moram no Supabase
     (Postgres), compartilhados entre todos os aparelhos/pessoas. Para
     não precisar reescrever as ~20 telas que já usam DB.find/insert/
     update de forma síncrona, o app carrega tudo do Supabase para um
     cache em memória assim que a página abre (aguarde `DB.ready`
     antes de usar qualquer outra função do DB), e cada escrita
     (insert/update/remove/...) atualiza esse cache na hora (para a
     tela responder rápido) e, em paralelo, envia a mesma alteração
     para o Supabase em segundo plano. Uma cópia no localStorage
     continua existindo como um "espelho" rápido/local, mas o Supabase
     é a fonte de verdade em modo online.
   ============================================================ */

(function (global) {
  "use strict";

  var STORAGE_KEY = "salaoErpDB_v1";
  var SEED_VERSION_KEY = "salaoErpSeedVersion_v1";
  var CURRENT_SEED_VERSION = "2026-08-20.1";

  var TABLES = [
    "employees", "clients", "costCenters", "categories", "services",
    "products", "stockMovements", "transactions", "appointments",
    "bankLines", "commissionPayouts", "settings", "users", "activityLog",
    "commissionBonuses", "occurrences", "cardMachines",
    "productConsumptions", "notifications", "approvals", "chamados"
  ];

  var ENV = global.ENV || {};
  var ONLINE_MODE = !!(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);
  var supa = null;

  if (ONLINE_MODE) {
    if (!global.supabase || !global.supabase.createClient) {
      console.error("Supabase JS SDK não encontrado — verifique se o <script> do CDN do Supabase está incluído ANTES de db.js. Caindo para modo offline (localStorage) nesta sessão.");
      ONLINE_MODE = false;
    } else {
      supa = global.supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
        auth: { persistSession: false }
      });
    }
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

  var _cache = null;

  // ---------------------------------------------------------------
  // Espelho local (localStorage): em modo offline é a única fonte de
  // dados, como sempre foi; em modo online é só uma cópia rápida para
  // a tela não ficar em branco enquanto busca do servidor, e para
  // continuar funcionando (em modo leitura recente) se a internet cair
  // no meio do uso.
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

  // Em modo online, tira das fotos (employees/clients.photoDataUrl) e dos
  // anexos (transactions/occurrences/commissionPayouts.attachment.dataUrl)
  // o base64 antes de gravar a cópia local — só nessa cópia, o `_cache` em
  // memória usado pela tela continua com tudo. Esses campos, em base64,
  // são o que mais rápido enche a cota de localStorage do navegador
  // (5-10MB típico) e travam TODA gravação local seguinte, mesmo em
  // tabelas sem nenhuma foto/anexo — já que a cópia local salva o banco
  // inteiro de uma vez. Em modo online isso é seguro: o Supabase (não o
  // localStorage) já é a fonte de verdade, e a cópia local existe só como
  // cache rápido/reserva se a internet cair no meio do uso.
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
  // IndexedDB — usado (só em modo online) como cópia local de reserva
  // COMPLETA, fotos/anexos incluídos. A cota do localStorage costuma
  // travar perto de 5-10MB (era a causa do "armazenamento cheio" — um
  // punhado de comprovantes/fotos em base64 já estourava isso), enquanto
  // o IndexedDB tem uma cota muito maior (na prática, uma fatia grande do
  // espaço livre em disco) — dá para guardar a base local inteira sem
  // precisar tirar nada dela. Se o IndexedDB não estiver disponível por
  // algum motivo, cai de volta para o localStorage enxuto (sem fotos/
  // anexos) como reserva de segurança.
  var IDB_NAME = "salaoErpIDB_v1";
  var IDB_STORE = "kv";
  var IDB_KEY = "db_mirror";

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

  function idbGetMirror() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function idbSetMirror(value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(value, IDB_KEY);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function persistLocalMirror() {
    if (ONLINE_MODE) {
      // Guarda o `_cache` completo (com fotos/anexos) no IndexedDB — sem
      // precisar tirar nada, já que a cota é bem maior que a do
      // localStorage. É "fire and forget": a tela já foi atualizada pelo
      // cache em memória, isso aqui é só a reserva para o caso de a
      // internet cair no meio do uso.
      idbSetMirror(_cache).catch(function (e) {
        console.error("Erro ao salvar cópia local (IndexedDB) dos dados — tentando reserva enxuta no localStorage", e);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stripLargeFieldsForMirror(_cache)));
        } catch (e2) {
          console.error("Erro ao salvar cópia local (localStorage) dos dados", e2);
          // Nenhuma das duas reservas locais funcionou — mas o Supabase já
          // tem os dados (remoteUpsert roda à parte, na hora da escrita),
          // então não vale interromper quem está trabalhando com um
          // alerta vermelho por causa só da cópia de reserva.
        }
      });
      return;
    }
    // Modo offline: localStorage é a ÚNICA cópia dos dados — se não
    // couber, o usuário precisa saber.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
    } catch (e) {
      console.error("Erro ao salvar cópia local dos dados", e);
      if (global.Toast) global.Toast.show("Erro ao salvar cópia local (armazenamento cheio?)", "danger");
    }
  }

  var _batchDepth = 0;

  function persist() {
    if (_batchDepth > 0) return; // deferred until the outer DB.batch() call finishes
    persistLocalMirror();
  }

  function fillMissingTables(db) {
    TABLES.forEach(function (t) { if (!db[t]) db[t] = t === "settings" ? {} : []; });
    return db;
  }

  // ---------------------------------------------------------------
  // MODO OFFLINE — idêntico ao comportamento original do sistema.
  // ---------------------------------------------------------------
  function loadOffline() {
    if (_cache) return _cache;
    var stored = loadLocalMirror();
    if (stored) {
      _cache = fillMissingTables(stored);
      // Safety net: never allow a DB with zero user accounts to exist —
      // that would make login impossible with no way back short of
      // clearing browser storage.
      if (!_cache.users.length) {
        _cache.users = emptyDB().users;
        persistLocalMirror();
      }
      return _cache;
    }
    _cache = emptyDB();
    persistLocalMirror();
    return _cache;
  }

  // ---------------------------------------------------------------
  // MODO ONLINE — busca tudo do Supabase e popula o cache em memória.
  // ---------------------------------------------------------------
  var _readyResolve;
  var readyPromise = new Promise(function (resolve) { _readyResolve = resolve; });

  function rowsToTableData(table, rows) {
    if (table === "settings") return rows.length ? rows[0].data : {};
    return rows.map(function (r) { return r.data; });
  }

  function bootstrapOnline() {
    // Cópia local de reserva: tenta o IndexedDB (cota grande, guarda tudo
    // incluindo fotos/anexos); se não achar nada lá (primeira vez rodando
    // esta versão), cai para a reserva antiga e enxuta que já estava no
    // localStorage, só para não perder a continuidade de quem já usava o
    // sistema. Isso só é usado como ponto de partida — nada é desenhado na
    // tela antes de DB.ready, então esse valor nunca aparece "errado" para
    // quem está usando; ele só importa de verdade se a internet cair antes
    // da busca abaixo terminar (ver o .catch mais adiante).
    idbGetMirror().then(function (idbStored) {
      var stored = idbStored || loadLocalMirror();
      _cache = stored ? fillMissingTables(stored) : emptyDB();

      var fetches = TABLES.map(function (t) {
        return supa.from(t).select("data").then(function (res) {
          if (res.error) throw res.error;
          return { table: t, rows: res.data || [] };
        });
      });

      Promise.all(fetches).then(function (results) {
        var fresh = {};
        results.forEach(function (r) { fresh[r.table] = rowsToTableData(r.table, r.rows); });
        fillMissingTables(fresh);
        // mesma rede de segurança do modo offline: nunca ficar sem usuário
        if (!fresh.users || !fresh.users.length) fresh.users = emptyDB().users;
        _cache = fresh;
        persistLocalMirror();
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

  if (ONLINE_MODE) {
    bootstrapOnline();
  } else {
    loadOffline();
    _readyResolve();
  }

  function load() { return _cache; }

  // ---------------------------------------------------------------
  // Sincronização em segundo plano com o Supabase (modo online).
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

  function remoteUpsert(table, record) {
    if (!ONLINE_MODE) return;
    supa.from(table).upsert({ id: record.id, data: record }).then(function (res) {
      if (res.error) remoteFail(table, "salvar", res.error);
    }).catch(function (err) { remoteFail(table, "salvar", err); });
  }

  function remoteDelete(table, id) {
    if (!ONLINE_MODE) return;
    supa.from(table).delete().eq("id", id).then(function (res) {
      if (res.error) remoteFail(table, "excluir", res.error);
    }).catch(function (err) { remoteFail(table, "excluir", err); });
  }

  // Apaga tudo de uma tabela no Supabase e regrava com a lista atual —
  // usado por setTable/resetAll/importJSON, que já substituem a tabela
  // inteira de uma vez no cache local.
  function remoteReplaceAll(table, records) {
    if (!ONLINE_MODE) return;
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
    if (!ONLINE_MODE) return;
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
    // (instantâneo em modo offline; aguarda a primeira busca no Supabase
    // em modo online). Toda página deve aguardar DB.ready antes de chamar
    // qualquer outra função do DB.
    ready: readyPromise,
    ONLINE_MODE: ONLINE_MODE,

    getSeedVersion: function () { return localStorage.getItem(SEED_VERSION_KEY); },
    setSeedVersion: function () { localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION); },
    CURRENT_SEED_VERSION: CURRENT_SEED_VERSION,

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
      persist();
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
      persist();
      records.forEach(function (r) { remoteUpsert(table, r); });
      return records;
    },

    update: function (table, id, patch) {
      var db = load();
      var idx = (db[table] || []).findIndex(function (r) { return r.id === id; });
      if (idx === -1) return null;
      db[table][idx] = Object.assign({}, db[table][idx], patch, { updatedAt: nowISO() });
      persist();
      remoteUpsert(table, db[table][idx]);
      return db[table][idx];
    },

    remove: function (table, id) {
      var db = load();
      var before = db[table].length;
      db[table] = db[table].filter(function (r) { return r.id !== id; });
      persist();
      var removed = db[table].length < before;
      if (removed) remoteDelete(table, id);
      return removed;
    },

    removeWhere: function (table, predicate) {
      var db = load();
      var toRemove = db[table].filter(predicate);
      db[table] = db[table].filter(function (r) { return !predicate(r); });
      persist();
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
      persist();
      if (table === "settings") remoteReplaceSettings(records);
      else remoteReplaceAll(table, records);
    },

    getSettings: function () { return load().settings || {}; },
    updateSettings: function (patch) {
      var db = load();
      db.settings = Object.assign({}, db.settings, patch);
      persist();
      remoteReplaceSettings(db.settings);
      return db.settings;
    },

    resetAll: function () {
      _cache = emptyDB();
      persist();
      localStorage.removeItem(SEED_VERSION_KEY);
      if (ONLINE_MODE) {
        TABLES.forEach(function (t) {
          if (t === "settings") remoteReplaceSettings(_cache.settings);
          else remoteReplaceAll(t, _cache[t]);
        });
      }
    },

    exportJSON: function () {
      return JSON.stringify(load(), null, 2);
    },

    importJSON: function (jsonStr) {
      var parsed = JSON.parse(jsonStr);
      _cache = fillMissingTables(parsed);
      persist();
      if (ONLINE_MODE) {
        TABLES.forEach(function (t) {
          if (t === "settings") remoteReplaceSettings(_cache.settings);
          else remoteReplaceAll(t, _cache[t]);
        });
      }
    },

    // Groups many insert/update/remove calls into a single localStorage write.
    // Use for any loop that mutates several records at once (bulk matching,
    // bulk import, etc.) — without it, each call inside the loop would
    // re-serialize the whole cópia local a cada iteração, o que fica lento
    // com tabelas de alguns milhares de linhas. As chamadas ao Supabase de
    // cada operação continuam acontecendo normalmente, uma a uma.
    batch: function (fn) {
      _batchDepth++;
      try {
        fn();
      } finally {
        _batchDepth--;
        if (_batchDepth === 0) persist();
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
      persist();
      remoteUpsert("activityLog", entry);
      return entry;
    },

    uid: uid,
    nowISO: nowISO
  };

  global.DB = DB;
})(window);
