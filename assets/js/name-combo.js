/* ============================================================
   Salão ERP — NameCombo (campo de nome com digitação livre + sugestões)
   ============================================================
   Substitui <select> de cliente/funcionário (que só deixava escolher um
   já cadastrado) por um campo de texto: digita-se o nome (e sobrenome)
   livremente, e uma lista de sugestões com os cadastros existentes
   aparece abaixo, sem travar a digitação em formato "somente selecionar".

   Compatibilidade: o elemento que guarda o id resolvido continua tendo o
   MESMO id/name usado hoje (ex.: "am-client"), só que agora é um
   <input type="hidden"> em vez de um <select> — então todo código
   existente que faz `box.querySelector("#am-client").value` ou escuta o
   evento "change" nesse elemento continua funcionando sem alteração,
   porque o NameCombo dispara um "change" sintético nele toda vez que a
   seleção muda.
   ============================================================ */

(function (global) {
  "use strict";

  function normName(s) {
    if (!s) return "";
    return String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  var uidCounter = 0;
  function nextUid() { uidCounter += 1; return "nc" + Date.now().toString(36) + uidCounter; }

  // opts: { id, label, items: [{id, label}], value (id inicial), placeholder,
  //         hiddenClass (classe extra no input hidden, ex. "si-emp"),
  //         required (bool, só efeito visual/placeholder) }
  function html(opts) {
    var textId = opts.id + "-text";
    var listId = opts.id + "-list";
    var initialItem = null;
    if (opts.value) {
      initialItem = (opts.items || []).filter(function (it) { return it.id === opts.value; })[0] || null;
    }
    var initialLabel = initialItem ? initialItem.label : (opts.initialLabel || "");
    return (
      '<div class="name-combo" style="position:relative;">' +
        '<input type="text" class="name-combo-input" id="' + textId + '" autocomplete="off"' + (opts.disabled ? " disabled" : "") + ' ' +
          'placeholder="' + (opts.placeholder || "Digite o nome...") + '" value="' + escapeAttr(initialLabel) + '">' +
        '<input type="hidden" id="' + opts.id + '"' + (opts.hiddenClass ? ' class="' + opts.hiddenClass + '"' : "") + ' value="' + escapeAttr(opts.value || "") + '">' +
        '<div class="name-combo-list" id="' + listId + '" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:50;background:var(--white,#fff);border:1px solid var(--border-color,#ddd);border-radius:var(--radius-md,6px);box-shadow:0 4px 14px rgba(0,0,0,.12);max-height:220px;overflow:auto;margin-top:2px;"></div>' +
      "</div>"
    );
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeHtml(s) {
    return escapeAttr(s);
  }

  // container: elemento que contém o markup gerado por html() (ex.: o `box` do Modal)
  // opts: { id, items: [{id, label}], onChange: function(item|null) }
  function wire(container, opts) {
    var textId = opts.id + "-text";
    var listId = opts.id + "-list";
    var textEl = container.querySelector("#" + textId);
    var hiddenEl = container.querySelector("#" + opts.id);
    var listEl = container.querySelector("#" + listId);
    if (!textEl || !hiddenEl || !listEl) return null;

    var items = opts.items || [];
    var activeIndex = -1;
    var currentMatches = [];

    function setResolved(item) {
      hiddenEl.value = item ? item.id : "";
      var ev = document.createEvent ? document.createEvent("HTMLEvents") : null;
      if (ev) { ev.initEvent("change", true, true); hiddenEl.dispatchEvent(ev); }
      else { hiddenEl.dispatchEvent(new Event("change", { bubbles: true })); }
      if (opts.onChange) opts.onChange(item);
    }

    function renderList(matches) {
      currentMatches = matches;
      activeIndex = -1;
      if (!matches.length) { listEl.style.display = "none"; listEl.innerHTML = ""; return; }
      listEl.innerHTML = matches.slice(0, 8).map(function (it, i) {
        return '<div class="name-combo-item" data-idx="' + i + '" style="padding:8px 10px;cursor:pointer;">' + escapeHtml(it.label) + "</div>";
      }).join("");
      listEl.style.display = "";
      Array.prototype.forEach.call(listEl.querySelectorAll(".name-combo-item"), function (el) {
        el.addEventListener("mousedown", function (e) {
          // mousedown (não click) para disparar antes do blur do input
          e.preventDefault();
          var idx = parseInt(el.getAttribute("data-idx"), 10);
          pick(currentMatches[idx]);
        });
        el.addEventListener("mouseenter", function () {
          activeIndex = parseInt(el.getAttribute("data-idx"), 10);
          highlight();
        });
      });
    }

    function highlight() {
      Array.prototype.forEach.call(listEl.querySelectorAll(".name-combo-item"), function (el, i) {
        el.style.background = i === activeIndex ? "var(--gray-100,#f2f2f2)" : "";
      });
    }

    function pick(item) {
      textEl.value = item.label;
      setResolved(item);
      listEl.style.display = "none";
    }

    function search(term) {
      var n = normName(term);
      if (!n) return items.slice(0, 8);
      return items.filter(function (it) { return normName(it.label).indexOf(n) !== -1; });
    }

    textEl.addEventListener("input", function () {
      renderList(search(textEl.value));
      // enquanto o texto digitado não corresponder exatamente a um item já
      // resolvido, o valor fica pendente (não força seleção)
      var exact = items.filter(function (it) { return normName(it.label) === normName(textEl.value); })[0];
      if (!exact) {
        if (hiddenEl.value) setResolved(null);
      }
    });

    textEl.addEventListener("focus", function () {
      renderList(search(textEl.value));
    });

    textEl.addEventListener("blur", function () {
      // pequeno atraso para permitir que o mousedown de um item da lista
      // seja processado antes de fecharmos a lista/validarmos o texto
      setTimeout(function () {
        listEl.style.display = "none";
        var exact = items.filter(function (it) { return normName(it.label) === normName(textEl.value); })[0];
        if (exact) {
          if (hiddenEl.value !== exact.id) { textEl.value = exact.label; setResolved(exact); }
        } else if (!textEl.value) {
          if (hiddenEl.value) setResolved(null);
        }
        // texto digitado não corresponde a nenhum cadastro: mantém o texto
        // como está (livre digitação), mas o id fica vazio — quem salvar o
        // formulário decide o que fazer com um nome não cadastrado.
      }, 150);
    });

    textEl.addEventListener("keydown", function (e) {
      if (listEl.style.display === "none") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
        highlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlight();
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && currentMatches[activeIndex]) {
          e.preventDefault();
          pick(currentMatches[activeIndex]);
        }
      } else if (e.key === "Escape") {
        listEl.style.display = "none";
      }
    });

    return {
      setItems: function (newItems) { items = newItems || []; },
      getValue: function () { return hiddenEl.value; },
      setValue: function (id) {
        var it = items.filter(function (x) { return x.id === id; })[0];
        if (it) { textEl.value = it.label; setResolved(it); }
        else { textEl.value = ""; setResolved(null); }
      },
      focus: function () { textEl.focus(); }
    };
  }

  global.NameCombo = { html: html, wire: wire, normName: normName, uid: nextUid };
})(window);
