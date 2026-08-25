/* ============================================================
   Salão ERP — Utilitários (formatação, toast, modal, helpers)
   ============================================================ */

(function (global) {
  "use strict";

  var Utils = {
    fmtMoney: function (value) {
      var n = Number(value) || 0;
      return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    },

    fmtNumber: function (value, decimals) {
      var n = Number(value) || 0;
      return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
    },

    fmtDate: function (isoDate) {
      if (!isoDate) return "-";
      var d = this.parseDate(isoDate);
      if (!d) return "-";
      return d.toLocaleDateString("pt-BR");
    },

    fmtDateTime: function (isoDate) {
      if (!isoDate) return "-";
      var d = new Date(isoDate);
      if (isNaN(d)) return "-";
      return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
    // backend/file storage — everything lives inside the localStorage JSON
    // blob — so keeping the photo small matters to avoid bloating it.
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
      return box;
    },
    close: function () {
      var ex = document.getElementById("active-modal-overlay");
      if (ex) ex.remove();
      document.removeEventListener("keydown", Modal._escHandler);
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
