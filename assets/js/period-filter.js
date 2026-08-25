/* ============================================================
   Salão ERP — Componente reutilizável de filtro de período
   Oferece atalhos rápidos (mês atual, últimos 3/6/12 meses etc.)
   além de um intervalo customizado "De" / "Até" para períodos
   estendidos ou curtos. Usado em Dashboard, DRE e Relatório de Vendas.
   ============================================================ */

(function (global) {
  "use strict";

  var PRESETS = [
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "mes", label: "Este mês" },
    { key: "3m", label: "Últimos 3 meses" },
    { key: "6m", label: "Últimos 6 meses" },
    { key: "12m", label: "Últimos 12 meses" },
    { key: "ano", label: "Este ano" },
    { key: "tudo", label: "Tudo" },
    { key: "custom", label: "Personalizado" }
  ];

  function rangeFor(key) {
    var today = Utils.todayISO();
    switch (key) {
      case "7d": return { start: Utils.addDays(today, -6), end: today };
      case "30d": return { start: Utils.addDays(today, -29), end: today };
      case "mes": return { start: today.slice(0, 8) + "01", end: today };
      case "3m": return { start: Utils.addMonths(today, -3), end: today };
      case "6m": return { start: Utils.addMonths(today, -6), end: today };
      case "12m": return { start: Utils.addMonths(today, -12), end: today };
      case "ano": return { start: today.slice(0, 4) + "-01-01", end: today };
      case "tudo": return { start: "2000-01-01", end: today };
      default: return { start: today.slice(0, 8) + "01", end: today };
    }
  }

  var PeriodFilter = {
    presets: PRESETS,
    rangeFor: rangeFor,

    // Filters an array of records by an ISO date field against {start,end}.
    filterByDate: function (arr, field, range) {
      if (!range) return arr.slice();
      return arr.filter(function (r) {
        var d = String(r[field] || "").slice(0, 10);
        return d >= range.start && d <= range.end;
      });
    },

    // Mounts the filter bar into `container` (a DOM element).
    // opts: { defaultPreset, onChange(range), label }
    // Returns a controller: { getRange(), setPreset(key), destroy() }
    mount: function (container, opts) {
      opts = opts || {};
      var defaultPreset = opts.defaultPreset || "mes";
      var initial = rangeFor(defaultPreset);
      var state = { preset: defaultPreset, start: initial.start, end: initial.end };

      function chipsHtml() {
        return PRESETS.map(function (p) {
          return '<button type="button" class="pf-preset-btn' + (state.preset === p.key ? " active" : "") + '" data-pf-preset="' + p.key + '">' + p.label + '</button>';
        }).join("");
      }

      function customHtml() {
        var show = state.preset === "custom";
        return '<div class="pf-custom-range" style="' + (show ? "" : "display:none;") + '">' +
          '<div class="form-field"><label>De</label><input type="date" id="pf-start" value="' + state.start + '"></div>' +
          '<div class="form-field"><label>Até</label><input type="date" id="pf-end" value="' + state.end + '"></div>' +
          '</div>';
      }

      function render() {
        container.innerHTML =
          '<div class="pf-bar">' +
          (opts.label ? '<span class="pf-label">' + Utils.escapeHtml(opts.label) + '</span>' : "") +
          '<div class="pf-chips">' + chipsHtml() + '</div>' +
          customHtml() +
          '<span class="pf-range-summary" id="pf-range-summary">' + Utils.fmtDate(state.start) + ' — ' + Utils.fmtDate(state.end) + '</span>' +
          '</div>';
        bind();
      }

      function bind() {
        Utils.qsa("[data-pf-preset]", container).forEach(function (btn) {
          btn.addEventListener("click", function () {
            var key = btn.getAttribute("data-pf-preset");
            state.preset = key;
            if (key !== "custom") {
              var r = rangeFor(key);
              state.start = r.start; state.end = r.end;
            }
            render();
            emit();
          });
        });
        var startInput = Utils.qs("#pf-start", container);
        var endInput = Utils.qs("#pf-end", container);
        if (startInput) {
          startInput.addEventListener("change", function () {
            state.start = startInput.value || state.start;
            if (state.start > state.end) state.end = state.start;
            updateSummary();
            emit();
          });
        }
        if (endInput) {
          endInput.addEventListener("change", function () {
            state.end = endInput.value || state.end;
            if (state.end < state.start) state.start = state.end;
            updateSummary();
            emit();
          });
        }
      }

      function updateSummary() {
        var el = Utils.qs("#pf-range-summary", container);
        if (el) el.textContent = Utils.fmtDate(state.start) + " — " + Utils.fmtDate(state.end);
        var s = Utils.qs("#pf-start", container), e = Utils.qs("#pf-end", container);
        if (s) s.value = state.start;
        if (e) e.value = state.end;
      }

      function emit() {
        if (opts.onChange) opts.onChange({ start: state.start, end: state.end, preset: state.preset });
      }

      render();

      return {
        getRange: function () { return { start: state.start, end: state.end, preset: state.preset }; },
        setPreset: function (key) {
          state.preset = key;
          if (key !== "custom") {
            var r = rangeFor(key);
            state.start = r.start; state.end = r.end;
          }
          render();
        },
        refresh: render
      };
    }
  };

  global.PeriodFilter = PeriodFilter;
})(window);
