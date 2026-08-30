/* ============================================================
   Salão ERP — Utilitários (formatação, toast, modal, helpers)
   ============================================================ */

(function (global) {
  "use strict";

  // Instâncias de Intl.* reaproveitadas entre chamadas (item 1 do plano de
  // otimização). new Intl.NumberFormat/DateTimeFormat(...) — que é o que
  // toLocaleString(...)/toLocaleDateString(...) fazem por baixo dos panos a
  // CADA chamada — tem um custo de criação não-trivial (parseia as opções,
  // resolve o locale). Essas funções são chamadas centenas de vezes por
  // render de tabela (uma vez por linha, por coluna de dinheiro/data), então
  // cachear as instâncias e só chamar .format() nelas evita recriar o
  // formatter do zero em cada célula. Comportamento de saída idêntico ao
  // toLocaleString equivalente — só a forma de obter o resultado muda.
  var _fmtMoneyBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var _fmtNumberCache = {}; // uma instância por quantidade de casas decimais usada
  var _fmtDateBR = new Intl.DateTimeFormat("pt-BR");
  var _fmtTimeBR = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function numberFormatterFor(decimals) {
    var key = decimals || 0;
    var f = _fmtNumberCache[key];
    if (!f) {
      f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: key, maximumFractionDigits: key });
      _fmtNumberCache[key] = f;
    }
    return f;
  }

  var Utils = {
    fmtMoney: function (value) {
      var n = Number(value) || 0;
      return _fmtMoneyBRL.format(n);
    },

    fmtNumber: function (value, decimals) {
      var n = Number(value) || 0;
      return numberFormatterFor(decimals).format(n);
    },

    fmtDate: function (isoDate) {
      if (!isoDate) return "-";
      var d = this.parseDate(isoDate);
      if (!d) return "-";
      return _fmtDateBR.format(d);
    },

    fmtDateTime: function (isoDate) {
      if (!isoDate) return "-";
      var d = new Date(isoDate);
      if (isNaN(d)) return "-";
      return _fmtDateBR.format(d) + " " + _fmtTimeBR.format(d);
    },

    // parses "YYYY-MM-DD" as local date to avoid TZ shifting issues
    parseDate: function (isoDate) {
      if (!isoDate) return null;
      var parts = String(isoDate).split("T")[0].split("-");
      if (parts.length !== 3) { var d2 = new Date(isoDate); return isNaN(d2) ? null : d2; }
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    },

    todayISO: function () {
      return this.toISODate(new Date());
    },

    toISODate: function (date) {
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, "0");
      var d = String(date.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    },

    addDays: function (isoDate, days) {
      var d = this.parseDate(isoDate);
      d.setDate(d.getDate() + days);
      return this.toISODate(d);
    },

    addMonths: function (isoDate, months) {
      var d = this.parseDate(isoDate);
      d.setMonth(d.getMonth() + months);
      return this.toISODate(d);
    },

    monthLabel: function (isoDate) {
      var d = this.parseDate(isoDate);
      return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
    },

    monthKey: function (isoDate) {
      var s = String(isoDate).split("T")[0];
      return s.slice(0, 7); // YYYY-MM
    },

    daysBetween: function (isoA, isoB) {
      var a = this.parseDate(isoA), b = this.parseDate(isoB);
      return Math.round((b - a) / 86400000);
    },

    initials: function (name) {
      if (!name) return "?";
      var parts = name.trim().split(/\s+/);
      var first = parts[0] ? parts[0][0] : "";
      var last = parts.length > 1 ? parts[parts.length - 1][0] : "";
      return (first + last).toUpperCase();
    },

    escapeHtml: function (str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },

    // Renders an "empty state" message inside a <table> element (as a single
    // colspan row) instead of replacing tbl.parentElement.innerHTML. Doing the
    // latter destroys the <table id="..."> node itself, so any later
    // document.getElementById()/Utils.qs() lookup for that id returns null and
    // crashes the next render() call — this keeps the table node alive.
    emptyTable: function (tbl, iconClass, title, subtitle) {
      tbl.innerHTML = '<tbody><tr><td colspan="99"><div class="empty-state"><div class="es-icon"><i class="fa-regular ' + iconClass + '"></i></div>' +
        '<h4>' + this.escapeHtml(title) + '</h4>' +
        (subtitle ? '<p>' + this.escapeHtml(subtitle) + '</p>' : '') +
        '</div></td></tr></tbody>';
    },

    qs: function (sel, ctx) { return (ctx || document).querySelector(sel); },
    qsa: function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); },

    el: function (tag, attrs, children) {
      var e = document.createElement(tag);
      attrs = attrs || {};
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") e.className = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      });
      (children || []).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    },

    debounce: function (fn, wait) {
      var t;
      return function () {
        var args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, wait || 250);
      };
    },

    downloadFile: function (filename, content, mime) {
      var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    slugify: function (str) {
      return String(str).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    },

    // simple CSV parser handling quoted fields and both , and ; delimiters
    parseCSV: function (text) {
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      var lines = text.split("\n").filter(function (l) { return l.length > 0; });
      if (!lines.length) return { headers: [], rows: [] };
      var delim = lines[0].indexOf(";") > -1 && lines[0].indexOf(",") === -1 ? ";" : (lines[0].split(";").length > lines[0].split(",").length ? ";" : ",");

      function parseLine(line) {
        var out = [], cur = "", inQuotes = false;
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (inQuotes) {
            if (ch === '"') {
              if (line[i + 1] === '"') { cur += '"'; i++; }
              else inQuotes = false;
            } else cur += ch;
          } else {
            if (ch === '"') inQuotes = true;
            else if (ch === delim) { out.push(cur); cur = ""; }
            else cur += ch;
          }
        }
        out.push(cur);
        return out.map(function (s) { return s.trim(); });
      }

      var headers = parseLine(lines[0]).map(function (h) { return h.toLowerCase(); });
      var rows = lines.slice(1).map(parseLine);
      return { headers: headers, rows: rows };
    },

    // formats a raw CPF string (11 digits) as "000.000.000-00"
    fmtCPF: function (cpf) {
      var digits = String(cpf || "").replace(/\D/g, "");
      if (digits.length !== 11) return cpf || "-";
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    },

    // strips formatting, returns only digits
    onlyDigits: function (str) {
      return String(str || "").replace(/\D/g, "");
    },

    // validates a Brazilian CPF using the standard check-digit algorithm.
    // Rejects obviously fake sequences (all same digit) too.
    isValidCPF: function (cpf) {
      var s = this.onlyDigits(cpf);
      if (s.length !== 11) return false;
      if (/^(\d)\1{10}$/.test(s)) return false;
      var sum = 0, i;
      for (i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
      var d1 = (sum * 10) % 11;
      if (d1 === 10) d1 = 0;
      if (d1 !== parseInt(s[9], 10)) return false;
      sum = 0;
      for (i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
      var d2 = (sum * 10) % 11;
      if (d2 === 10) d2 = 0;
      if (d2 !== parseInt(s[10], 10)) return false;
      return true;
    },

    // password rule for this system: minimum 6 digits, numbers only
    isValidPassword: function (pwd) {
      return /^[0-9]{6,}$/.test(String(pwd || ""));
    },

    // Regra do sistema: todo telefone cadastrado precisa incluir o DDD.
    // Um celular brasileiro com DDD tem 11 dígitos (DDD + 9 + 8 dígitos);
    // ainda aceitamos 10 (DDD + fixo/celular antigo de 8 dígitos) para não
    // travar cadastros de linha fixa. Rejeita sequências óbvias (mesmo
    // dígito repetido) e qualquer coisa com menos de 10 dígitos, que é o
    // erro mais comum (número sem DDD).
    isValidPhoneBR: function (phone) {
      var s = this.onlyDigits(phone);
      if (s.length !== 10 && s.length !== 11) return false;
      if (/^(\d)\1+$/.test(s)) return false;
      var ddd = parseInt(s.slice(0, 2), 10);
      if (ddd < 11 || ddd > 99) return false;
      return true;
    },

    // Trava de caracteres do campo de telefone — mesmo espírito da máscara
    // que o campo de CPF já tinha, mas até agora faltava aqui. Formata
    // "(11) 98765-4321" à medida que a pessoa digita e limita a 11 dígitos
    // (DDD + celular), impedindo que sobre lixo/tamanho errado salvo no
    // cadastro — é exatamente esse tipo de número mal formado que fazia o
    // robô de notificações por WhatsApp falhar ao montar o link wa.me.
    wirePhoneMask: function (input) {
      if (!input) return;
      input.setAttribute("maxlength", "15"); // tamanho de "(11) 98765-4321"
      input.addEventListener("input", function (e) {
        var digits = Utils.onlyDigits(e.target.value).slice(0, 11);
        var out = "";
        if (digits.length === 0) out = "";
        else if (digits.length <= 2) out = "(" + digits;
        else if (digits.length <= 6) out = "(" + digits.slice(0, 2) + ") " + digits.slice(2);
        else if (digits.length <= 10) out = "(" + digits.slice(0, 2) + ") " + digits.slice(2, 6) + "-" + digits.slice(6);
        else out = "(" + digits.slice(0, 2) + ") " + digits.slice(2, 7) + "-" + digits.slice(7);
        e.target.value = out;
      });
    },

    // Máscara de valor em reais (campos "... (R$)" do sistema): o campo
    // vira um <input type="text">, e cada dígito digitado entra pela
    // direita como centavo — igual ao padrão usado em apps de banco/
    // pagamento no Brasil (ex.: digitar "180000" forma "1.800,00" aos
    // poucos, dígito a dígito). Evita qualquer ambiguidade de onde fica a
    // vírgula/ponto: como só dígitos digitados pelo usuário contam (a
    // pontuação inserida pela própria máscara é sempre descartada e
    // reconstruída do zero a cada tecla), não há como o valor sair errado
    // por causa da posição do cursor.
    // `initialValue` (opcional): número já salvo (ex.: 1800) para deixar o
    // campo pré-preenchido e formatado ao abrir um cadastro existente.
    wireMoneyMask: function (input, initialValue) {
      if (!input) return;
      Utils.wireMoneyMaskListener(input);
      Utils.setMoneyMaskValue(input, initialValue);
    },

    // Só anexa o comportamento de digitação (attrs + listener), sem mexer
    // no value atual do campo — usar quando o HTML já foi montado com o
    // value já formatado (ex.: linha de item dinâmica recriada a partir de
    // um array em memória cujos valores já estão no formato "1.800,00").
    wireMoneyMaskListener: function (input) {
      if (!input) return;
      function centsFromDigits(raw) {
        var d = String(raw || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
        return d ? parseInt(d, 10) : 0;
      }
      function fmt(cents) {
        return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      input.setAttribute("type", "text");
      input.setAttribute("inputmode", "numeric");
      input.setAttribute("autocomplete", "off");
      input.setAttribute("placeholder", "0,00");
      input.addEventListener("input", function () {
        var cents = centsFromDigits(input.value);
        input.value = cents ? fmt(cents) : "";
      });
    },

    // Retorna a string formatada (ex.: "1.800,00", sem "R$") equivalente ao
    // que wireMoneyMask deixaria no campo — usar ao montar HTML de
    // formulário (value="...") para uma lista de linhas dinâmica, já que
    // nesses casos ainda não existe um <input> no DOM para chamar
    // setMoneyMaskValue.
    moneyMaskValueStr: function (value) {
      var n = Number(value);
      return n ? (Math.round(n * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
    },

    // Formata e escreve um número (em reais) num campo já convertido por
    // wireMoneyMask, sem reanexar o listener — usar para atualizar o campo
    // programaticamente (ex.: valor calculado automaticamente a partir de
    // outro campo).
    setMoneyMaskValue: function (input, value) {
      if (!input) return;
      input.value = Utils.moneyMaskValueStr(value);
    },

    // Converte a string formatada por wireMoneyMask (ex.: "1.800,00") de
    // volta para número — usar quando o valor já foi lido do DOM antes (ex.:
    // guardado num array de itens em memória), e não há mais o <input> à
    // mão para chamar moneyMaskToFloat.
    parseMoneyMaskStr: function (str) {
      var d = String(str || "").replace(/\D/g, "");
      return d ? parseInt(d, 10) / 100 : 0;
    },

    // Lê de volta o número (em reais, com decimais) de um campo com
    // wireMoneyMask aplicado — usar isso ao salvar, no lugar de
    // parseFloat(input.value).
    moneyMaskToFloat: function (input) {
      if (!input) return 0;
      return Utils.parseMoneyMaskStr(input.value);
    },

    // Formata um telefone já validado (10 ou 11 dígitos) como
    // "(11) 98765-4321" / "(11) 3456-7890", para exibição.
    fmtPhoneBR: function (phone) {
      var s = this.onlyDigits(phone);
      if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
      if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
      return phone || "";
    },

    // parses numbers like "1.234,56" or "1234.56" or "-45,00"
    parseMoneyStr: function (str) {
      if (typeof str === "number") return str;
      if (!str) return 0;
      str = String(str).trim().replace(/[R$\s]/g, "");
      var neg = false;
      if (/^\(.*\)$/.test(str)) { neg = true; str = str.replace(/[()]/g, ""); }
      if (str.indexOf(",") > -1 && str.indexOf(".") > -1) {
        if (str.lastIndexOf(",") > str.lastIndexOf(".")) str = str.replace(/\./g, "").replace(",", ".");
        else str = str.replace(/,/g, "");
      } else if (str.indexOf(",") > -1) {
        str = str.replace(/\./g, "").replace(",", ".");
      }
      var n = parseFloat(str);
      if (isNaN(n)) return 0;
      return neg ? -Math.abs(n) : n;
    },

    // Divide a comissão de um atendimento concluído entre o profissional
    // principal e o assistente (quando houver). O "pote" do principal é
    // sempre appt.price * taxaPrincipal/100 — a taxa vem de appt.commissionPercent
    // (se o agendamento tiver uma taxa específica) ou da taxa padrão do
    // funcionário. Quando há assistente, appt.assistantCommissionPercent
    // define a comissão CHEIA dele (também em % do valor do serviço) — o
    // assistente sempre recebe o valor integral. O CUSTO dessa comissão é
    // dividido 50/50: metade é descontada do pote do profissional principal,
    // a outra metade é um custo assumido pelo salão (não é descontada de
    // ninguém — por isso o total pago em comissão nesse atendimento passa a
    // ser maior que o pote sozinho quando há assistente).
    apptCommissionSplit: function (appt, employee) {
      var round2 = function (n) { return Math.round(n * 100) / 100; };
      var price = Number(appt && appt.price) || 0;
      var mainRate = (appt && appt.commissionPercent != null && appt.commissionPercent !== "")
        ? Number(appt.commissionPercent)
        : Number(employee && employee.commissionRate) || 0;
      var pool = round2(price * (mainRate / 100));
      if (appt && appt.assistantId && appt.assistantCommissionPercent != null) {
        var assistantAmount = round2(price * (Number(appt.assistantCommissionPercent) / 100));
        var deductedFromMain = round2(assistantAmount / 2);
        var salonShare = round2(assistantAmount - deductedFromMain);
        var mainCommission = round2(pool - deductedFromMain);
        if (mainCommission < 0) { salonShare = round2(salonShare + Math.abs(mainCommission)); mainCommission = 0; }
        return { mainCommission: mainCommission, assistantCommission: assistantAmount, assistantId: appt.assistantId, pool: pool, salonShare: salonShare };
      }
      return { mainCommission: pool, assistantCommission: 0, assistantId: null, pool: pool, salonShare: 0 };
    },

    // Renders an avatar circle: a photo (if photoUrl is set — a data: URL
    // stored inline since this app has no file backend) or a fallback with
    // the person's initials. Used anywhere a person's small round avatar
    // shows up (employee tables, the Agenda calendar header, etc.) so the
    // photo-or-initials logic lives in exactly one place.
    avatarHtml: function (name, photoUrl, extraClass) {
      var cls = "avatar" + (extraClass ? " " + extraClass : "");
      if (photoUrl) {
        return '<div class="' + cls + ' avatar-photo" style="background-image:url(\'' + photoUrl + '\');" title="' + this.escapeHtml(name || "") + '"></div>';
      }
      return '<div class="' + cls + '" title="' + this.escapeHtml(name || "") + '">' + this.initials(name) + '</div>';
    },

    // Reads an image File selected in a <input type="file">, downsizes it
    // client-side (via canvas, cropped to a square) and returns a compact
    // base64 JPEG data URL through callback(dataUrl|null). This app has no
    // dedicated file storage — the image stays embedded as base64 inside
    // the record's own JSON (in the Supabase jsonb column) — so keeping
    // the photo small matters to avoid bloating it.
    fileToAvatarDataUrl: function (file, maxSize, callback) {
      maxSize = maxSize || 160;
      if (!file) { callback(null); return; }
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var size = Math.min(img.width, img.height);
          var sx = (img.width - size) / 2, sy = (img.height - size) / 2;
          var canvas = document.createElement("canvas");
          canvas.width = maxSize; canvas.height = maxSize;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
          callback(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = function () { callback(null); };
        img.src = ev.target.result;
      };
      reader.onerror = function () { callback(null); };
      reader.readAsDataURL(file);
    },

    // Converte uma data: URL (ex.: "data:application/pdf;base64,JVBERi0...")
    // em uma blob: URL (ex.: "blob:https://.../abc-123"). Necessário porque,
    // desde o Chrome 88, o navegador BLOQUEIA a navegação de uma aba/janela
    // inteira para uma data: URL (seja via clique num <a href="data:...">
    // seja via script setando window.location.href) — a aba fica presa em
    // "about:blank#blocked" e o comprovante nunca abre. blob: URLs não têm
    // essa restrição, então usamos esta função em todo lugar que abre o
    // anexo em uma nova aba/janela (o <img src="dataUrl"> de preview inline
    // continua usando a data: URL direto, pois isso é só carregar um
    // recurso, não navegar — não é afetado pelo bloqueio).
    // Retorna null se a conversão falhar (dataUrl inválida/vazia).
    dataUrlToBlobUrl: function (dataUrl) {
      if (!dataUrl || dataUrl.indexOf("data:") !== 0) return null;
      try {
        var comma = dataUrl.indexOf(",");
        var meta = dataUrl.slice(5, comma); // ex.: "application/pdf;base64"
        var isBase64 = meta.indexOf("base64") > -1;
        var mime = (meta.split(";")[0]) || "application/octet-stream";
        var body = dataUrl.slice(comma + 1);
        var raw = isBase64 ? atob(body) : decodeURIComponent(body);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (e) {
        console.error("Falha ao converter anexo (data URL) em blob URL", e);
        return null;
      }
    },

    // Reads ANY file (PDF, foto de atestado, comprovante etc.) as base64 e
    // devolve um objeto { name, type, size, dataUrl } via callback(obj|null).
    // Usado para anexos que não são a foto de perfil de alguém (ver
    // fileToAvatarDataUrl acima) — ex.: anexo de ocorrência (atestado
    // médico) e comprovante de pagamento. Como este sistema não tem um
    // servidor de arquivos próprio (tudo mora dentro do blob JSON da
    // tabela, no Supabase), limita o tamanho para não pesar demais a
    // sincronização — arquivos maiores devem ser compactados/fotografados
    // com menor resolução antes de anexar.
    fileToAttachmentDataUrl: function (file, maxBytes, callback) {
      maxBytes = maxBytes || 4 * 1024 * 1024; // 4MB
      if (!file) { callback(null); return; }
      if (file.size > maxBytes) {
        callback({ error: "toolarge", maxBytes: maxBytes });
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        callback({ name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl: ev.target.result });
      };
      reader.onerror = function () { callback(null); };
      reader.readAsDataURL(file);
    },

    // ---- Campo de anexo genérico (comprovante de pagamento etc.) ----
    // Gera o HTML de um campo "Anexar arquivo" com preview, e devolve (via
    // Utils.wireAttachmentField) um objeto { get(), set(val) } para ler/
    // definir o anexo atual — usado em qualquer modal que precise anexar um
    // comprovante (pagamento de comissão, lançamento financeiro etc.), sem
    // duplicar essa lógica em cada tela.
    attachmentFieldHtml: function (idPrefix, label) {
      return '<div class="form-field full">' +
        '<label>' + (label || "Comprovante (opcional)") + '</label>' +
        '<div id="' + idPrefix + '-attach-preview" style="margin-bottom:8px;"></div>' +
        '<label class="btn btn-sm btn-outline" style="cursor:pointer;">Anexar arquivo<input type="file" id="' + idPrefix + '-attach-input" accept="image/*,application/pdf" style="display:none;"></label>' +
        ' <button type="button" class="btn btn-sm btn-ghost" id="' + idPrefix + '-attach-remove" style="display:none;">Remover anexo</button>' +
        '<div class="small text-muted mt-8">Foto ou PDF do comprovante. Tamanho máximo: 4MB.</div>' +
        '</div>';
    },
    wireAttachmentField: function (box, idPrefix, existing) {
      var attachment = existing || null;
      var previewEl = box.querySelector("#" + idPrefix + "-attach-preview");
      var removeBtn = box.querySelector("#" + idPrefix + "-attach-remove");
      var inputEl = box.querySelector("#" + idPrefix + "-attach-input");
      function renderPreview() {
        if (!attachment) { previewEl.innerHTML = ""; removeBtn.style.display = "none"; return; }
        var isImg = (attachment.type || "").indexOf("image/") === 0;
        // O <a href> usa uma blob: URL (não a data: URL direto) porque o
        // Chrome bloqueia navegação de aba para data: URL — ver comentário
        // em Utils.dataUrlToBlobUrl. O <img src> pode usar a data: URL
        // normalmente, pois carregar um recurso não é o mesmo que navegar.
        var openUrl = global.Utils.dataUrlToBlobUrl(attachment.dataUrl) || attachment.dataUrl || "#";
        previewEl.innerHTML = isImg
          ? '<a href="' + openUrl + '" target="_blank" rel="noopener"><img src="' + attachment.dataUrl + '" alt="Anexo" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid var(--border-color);"></a>'
          : '<a href="' + openUrl + '" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> ' + global.Utils.escapeHtml(attachment.name) + '</a>';
        removeBtn.style.display = "";
      }
      renderPreview();
      if (inputEl) {
        inputEl.addEventListener("change", function (ev) {
          var file = ev.target.files && ev.target.files[0];
          if (!file) return;
          global.Utils.fileToAttachmentDataUrl(file, 4 * 1024 * 1024, function (result) {
            if (!result) { global.Toast.show("Não foi possível carregar esse arquivo", "danger"); return; }
            if (result.error === "toolarge") { global.Toast.show("Arquivo muito grande (máximo 4MB)", "danger"); return; }
            attachment = result;
            renderPreview();
          });
        });
      }
      if (removeBtn) {
        removeBtn.addEventListener("click", function () { attachment = null; renderPreview(); });
      }
      return { get: function () { return attachment; }, set: function (val) { attachment = val; renderPreview(); } };
    }
  };

  // ---------------- Toast ----------------
  var Toast = {
    show: function (msg, type, ms) {
      var stack = document.getElementById("toast-stack");
      if (!stack) {
        stack = document.createElement("div");
        stack.id = "toast-stack";
        document.body.appendChild(stack);
      }
      var icon = type === "success" ? "✓" : type === "danger" ? "✕" : type === "info" ? "ℹ" : "•";
      var t = document.createElement("div");
      t.className = "toast" + (type ? " " + type : "");
      t.innerHTML = '<span>' + icon + '</span><span>' + Utils.escapeHtml(msg) + '</span>';
      stack.appendChild(t);
      setTimeout(function () {
        t.style.transition = "opacity .2s ease";
        t.style.opacity = "0";
        setTimeout(function () { t.remove(); }, 200);
      }, ms || 2800);
    }
  };

  // ---------------- Modal ----------------
  var Modal = {
    _overlay: null,
    open: function (opts) {
      this.close();
      var overlay = document.createElement("div");
      overlay.className = "modal-overlay open";
      overlay.id = "active-modal-overlay";
      var box = document.createElement("div");
      box.className = "modal-box" + (opts.wide ? " modal-wide" : "");
      box.innerHTML =
        '<div class="modal-head"><h3>' + Utils.escapeHtml(opts.title || "") + '</h3>' +
        '<button class="modal-close-btn" data-close-modal>&times;</button></div>' +
        '<div class="modal-body">' + (opts.bodyHtml || "") + '</div>' +
        (opts.footHtml ? '<div class="modal-foot">' + opts.footHtml + '</div>' : '');
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay || e.target.hasAttribute("data-close-modal")) Modal.close();
      });
      this._overlay = overlay;
      if (opts.onMount) opts.onMount(box);
      document.addEventListener("keydown", Modal._escHandler);
      // Trava o scroll da página por trás enquanto o modal está aberto —
      // sem isso, no celular, rolar até o fim do formulário do modal e
      // continuar arrastando "vaza" o gesto para a página de baixo, dando
      // a sensação de bug ao rolar a tela.
      document.body.classList.add("modal-open-lock");
      return box;
    },
    close: function () {
      var ex = document.getElementById("active-modal-overlay");
      if (ex) ex.remove();
      document.removeEventListener("keydown", Modal._escHandler);
      document.body.classList.remove("modal-open-lock");
    },
    _escHandler: function (e) { if (e.key === "Escape") Modal.close(); },
    confirm: function (opts) {
      var body = '<p>' + Utils.escapeHtml(opts.message || "Tem certeza?") + '</p>';
      var foot =
        '<button class="btn btn-secondary" data-close-modal>Cancelar</button>' +
        '<button class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") + '" id="modal-confirm-btn">' + (opts.confirmLabel || "Confirmar") + '</button>';
      var box = this.open({ title: opts.title || "Confirmar ação", bodyHtml: body, footHtml: foot });
      box.querySelector("#modal-confirm-btn").addEventListener("click", function () {
        Modal.close();
        if (opts.onConfirm) opts.onConfirm();
      });
    }
  };

  global.Utils = Utils;
  global.Toast = Toast;
  global.Modal = Modal;
})(window);
