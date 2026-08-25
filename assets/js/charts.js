/* ============================================================
   Salão ERP — Mini biblioteca de gráficos (SVG, sem dependências)
   Segue a paleta categórica validada (8 matizes, ordem fixa) e as
   especificações de marca (barras finas, cantos 4px, linhas 2px,
   grid hairline, legenda, tooltip no hover).
   ============================================================ */

(function (global) {
  "use strict";

  var CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
  var INK_SECOND = "#52514e";
  var INK_MUTED = "#898781";
  var GRID = "#e1e0d9";
  var SUCCESS = "#006300";
  var DANGER = "#c23b3b";

  function fmtCompact(n) {
    var abs = Math.abs(n);
    if (abs >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
    if (abs >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
    return String(Math.round(n));
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var norm = v / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function ensureTooltip() {
    var tip = document.getElementById("chart-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "chart-tooltip";
      tip.style.cssText = "position:fixed;pointer-events:none;z-index:500;background:#1c161a;color:#fff;" +
        "padding:8px 11px;border-radius:8px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);" +
        "display:none;line-height:1.5;max-width:240px;";
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(x, y, html) {
    var tip = ensureTooltip();
    tip.innerHTML = html;
    tip.style.display = "block";
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 14, top = y - h - 10;
    if (left + w > window.innerWidth - 10) left = x - w - 14;
    if (top < 10) top = y + 14;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { var tip = document.getElementById("chart-tooltip"); if (tip) tip.style.display = "none"; }

  function buildLegend(container, series) {
    if (series.length < 2) return;
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:" + INK_SECOND + ";";
    series.forEach(function (s) {
      var item = document.createElement("div");
      item.style.cssText = "display:flex;align-items:center;gap:6px;";
      item.innerHTML = '<span style="width:9px;height:9px;border-radius:2px;background:' + s.color + ';display:inline-block;"></span>' + Utils.escapeHtml(s.name);
      wrap.appendChild(item);
    });
    container.appendChild(wrap);
  }

  var Charts = {
    palette: CAT,
    fmtCompact: fmtCompact,

    empty: function (container, message) {
      container.innerHTML = '<div class="empty-state"><div class="es-icon"><i class="fa-regular fa-chart-bar"></i></div><h4>' +
        Utils.escapeHtml(message || "Sem dados no período") + '</h4></div>';
    },

    // series: [{name, color, data:[numbers]}], categories: [labels]
    bar: function (opts) {
      var container = opts.container;
      container.innerHTML = "";
      var series = opts.series || [];
      var categories = opts.categories || [];
      if (!categories.length || !series.length) { this.empty(container, opts.emptyMessage); return; }

      var W = container.clientWidth || 600, H = opts.height || 260;
      var padL = 44, padR = 12, padT = 14, padB = 30;
      var plotW = W - padL - padR, plotH = H - padT - padB;

      var maxVal = 0;
      series.forEach(function (s) { s.data.forEach(function (v) { if (v > maxVal) maxVal = v; }); });
      var top = niceMax(maxVal * 1.12 || 10);

      var svg = svgEl("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H, style: "overflow:visible;font-family:inherit;" });

      // gridlines + y labels
      var steps = 4;
      for (var g = 0; g <= steps; g++) {
        var val = (top / steps) * g;
        var y = padT + plotH - (val / top) * plotH;
        svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
        var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10.5, fill: INK_MUTED });
        lbl.textContent = fmtCompact(val);
        svg.appendChild(lbl);
      }

      var groupW = plotW / categories.length;
      var barsPerGroup = series.length;
      var maxBarThick = 22;
      var barW = Math.min(maxBarThick, (groupW * 0.6) / barsPerGroup);
      var gap = 2;

      categories.forEach(function (cat, ci) {
        var groupX = padL + ci * groupW;
        var totalBarsW = barsPerGroup * barW + (barsPerGroup - 1) * gap;
        var startX = groupX + (groupW - totalBarsW) / 2;

        series.forEach(function (s, si) {
          var v = s.data[ci] || 0;
          var barH = top > 0 ? (v / top) * plotH : 0;
          var x = startX + si * (barW + gap);
          var y = padT + plotH - barH;
          var rectG = svgEl("g", { class: "bar-hit" });
          var rx = Math.min(4, barW / 2);
          var rect = svgEl("path", {
            d: roundedTopRectPath(x, y, barW, Math.max(barH, 1), rx),
            fill: s.color
          });
          var hit = svgEl("rect", { x: x - 1, y: padT, width: barW + 2, height: plotH, fill: "transparent" });
          rectG.appendChild(rect);
          rectG.appendChild(hit);
          rectG.addEventListener("mousemove", function (e) {
            showTip(e.clientX, e.clientY, '<div style="font-weight:700;margin-bottom:2px;">' + Utils.escapeHtml(cat) + '</div>' +
              '<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + s.color + ';margin-right:6px;"></span>' +
              Utils.escapeHtml(s.name) + ": " + (opts.valueFormatter ? opts.valueFormatter(v) : v) + '</div>');
          });
          rectG.addEventListener("mouseleave", hideTip);
          svg.appendChild(rectG);
        });

        var xl = svgEl("text", { x: groupX + groupW / 2, y: H - 8, "text-anchor": "middle", "font-size": 10.5, fill: INK_MUTED });
        xl.textContent = truncateLabel(cat, groupW);
        var xlTitle = svgEl("title", {});
        xlTitle.textContent = cat;
        xl.appendChild(xlTitle);
        svg.appendChild(xl);
      });

      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: padT + plotH, y2: padT + plotH, stroke: "#c3c2b7", "stroke-width": 1 }));

      container.appendChild(svg);
      buildLegend(container, series.length > 1 ? series : []);
    },

    // series: [{name, color, data:[numbers]}]
    line: function (opts) {
      var container = opts.container;
      container.innerHTML = "";
      var series = opts.series || [];
      var categories = opts.categories || [];
      if (!categories.length || !series.length) { this.empty(container, opts.emptyMessage); return; }

      var W = container.clientWidth || 600, H = opts.height || 260;
      var padL = 44, padR = 16, padT = 16, padB = 30;
      var plotW = W - padL - padR, plotH = H - padT - padB;

      var maxVal = 0, minVal = 0;
      series.forEach(function (s) { s.data.forEach(function (v) { if (v > maxVal) maxVal = v; if (v < minVal) minVal = v; }); });
      var top = niceMax(maxVal * 1.15 || 10);
      var bottom = minVal < 0 ? -niceMax(-minVal * 1.15) : 0;

      var svg = svgEl("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H, style: "overflow:visible;font-family:inherit;" });

      var steps = 4;
      for (var g = 0; g <= steps; g++) {
        var val = bottom + ((top - bottom) / steps) * g;
        var y = padT + plotH - ((val - bottom) / (top - bottom)) * plotH;
        svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
        var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10.5, fill: INK_MUTED });
        lbl.textContent = fmtCompact(val);
        svg.appendChild(lbl);
      }

      function xPos(i) { return padL + (categories.length === 1 ? plotW / 2 : (i / (categories.length - 1)) * plotW); }
      function yPos(v) { return padT + plotH - ((v - bottom) / (top - bottom || 1)) * plotH; }

      series.forEach(function (s) {
        if (opts.area) {
          var areaPts = s.data.map(function (v, i) { return xPos(i) + "," + yPos(v); }).join(" L ");
          var d = "M " + xPos(0) + "," + yPos(bottom) + " L " + areaPts + " L " + xPos(s.data.length - 1) + "," + yPos(bottom) + " Z";
          svg.appendChild(svgEl("path", { d: d, fill: s.color, opacity: 0.1, stroke: "none" }));
        }
        var pts = s.data.map(function (v, i) { return xPos(i) + "," + yPos(v); }).join(" L ");
        svg.appendChild(svgEl("path", { d: "M " + pts, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      });

      // hover crosshair
      var hoverLine = svgEl("line", { x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: "#c3c2b7", "stroke-width": 1, style: "display:none;" });
      svg.appendChild(hoverLine);
      var dots = [];
      series.forEach(function (s) {
        var sd = [];
        s.data.forEach(function (v, i) {
          var c = svgEl("circle", { cx: xPos(i), cy: yPos(v), r: 4, fill: s.color, stroke: "#fff", "stroke-width": 2, style: "display:none;" });
          svg.appendChild(c);
          sd.push(c);
        });
        dots.push(sd);
      });

      var hitRect = svgEl("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
      hitRect.addEventListener("mousemove", function (e) {
        var rect = svg.getBoundingClientRect();
        var scaleX = W / rect.width;
        var localX = (e.clientX - rect.left) * scaleX;
        var idx = Math.round(((localX - padL) / plotW) * (categories.length - 1));
        idx = Math.max(0, Math.min(categories.length - 1, idx));
        hoverLine.setAttribute("x1", xPos(idx)); hoverLine.setAttribute("x2", xPos(idx));
        hoverLine.style.display = "block";
        var html = '<div style="font-weight:700;margin-bottom:4px;">' + Utils.escapeHtml(categories[idx]) + '</div>';
        series.forEach(function (s, si) {
          dots.forEach(function (sd, dsi) { sd.forEach(function (c, ci) { c.style.display = ci === idx ? "block" : "none"; }); });
          var v = s.data[idx];
          html += '<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + s.color + ';margin-right:6px;"></span>' +
            Utils.escapeHtml(s.name) + ": " + (opts.valueFormatter ? opts.valueFormatter(v) : v) + '</div>';
        });
        showTip(e.clientX, e.clientY, html);
      });
      hitRect.addEventListener("mouseleave", function () {
        hoverLine.style.display = "none";
        dots.forEach(function (sd) { sd.forEach(function (c) { c.style.display = "none"; }); });
        hideTip();
      });
      svg.appendChild(hitRect);

      var everyNth = Math.ceil(categories.length / 8);
      categories.forEach(function (cat, i) {
        if (i % everyNth !== 0 && i !== categories.length - 1) return;
        var xl = svgEl("text", { x: xPos(i), y: H - 8, "text-anchor": "middle", "font-size": 10.5, fill: INK_MUTED });
        xl.textContent = cat;
        svg.appendChild(xl);
      });

      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yPos(0), y2: yPos(0), stroke: "#c3c2b7", "stroke-width": 1 }));

      container.appendChild(svg);
      buildLegend(container, series.length > 1 ? series : []);
    },

    // items: [{label, value, color?}] — an HTML ranking list (rank number,
    // label, proportional bar, value), sorted by the caller. Prefer this
    // over bar() for "top N by name" rankings (categories, professionals,
    // expenses...) since long names would otherwise get truncated as
    // x-axis labels on a vertical bar chart.
    rankingList: function (opts) {
      var container = opts.container;
      container.innerHTML = "";
      var items = (opts.items || []).slice();
      if (opts.maxItems) items = items.slice(0, opts.maxItems);
      if (!items.length) { this.empty(container, opts.emptyMessage); return; }
      var maxVal = 0;
      items.forEach(function (it) { var v = Math.abs(Number(it.value) || 0); if (v > maxVal) maxVal = v; });
      if (!maxVal) maxVal = 1;
      var wrap = document.createElement("div");
      wrap.className = "ranking-list";
      items.forEach(function (it, idx) {
        var v = Number(it.value) || 0;
        var pct = Math.max(2, Math.round((Math.abs(v) / maxVal) * 100));
        var color = it.color || CAT[idx % CAT.length];
        var row = document.createElement("div");
        row.className = "ranking-row";
        row.innerHTML =
          '<div class="ranking-rank">' + (idx + 1) + 'º</div>' +
          '<div class="ranking-main">' +
            '<div class="ranking-label"></div>' +
            '<div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
          '</div>' +
          '<div class="ranking-value">' + (opts.valueFormatter ? opts.valueFormatter(v) : v) + '</div>';
        row.querySelector(".ranking-label").textContent = it.label;
        wrap.appendChild(row);
      });
      container.appendChild(wrap);
    },

    sparkline: function (container, data, color) {
      container.innerHTML = "";
      if (!data.length) return;
      var W = container.clientWidth || 100, H = 32;
      var max = Math.max.apply(null, data), min = Math.min.apply(null, data);
      var range = (max - min) || 1;
      var svg = svgEl("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H });
      var pts = data.map(function (v, i) {
        var x = (i / (data.length - 1 || 1)) * (W - 6) + 3;
        var y = H - 4 - ((v - min) / range) * (H - 8);
        return x + "," + y;
      }).join(" L ");
      svg.appendChild(svgEl("path", { d: "M " + pts, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      var lastX = (( data.length - 1) / (data.length - 1 || 1)) * (W - 6) + 3;
      var lastY = H - 4 - ((data[data.length - 1] - min) / range) * (H - 8);
      svg.appendChild(svgEl("circle", { cx: lastX, cy: lastY, r: 3, fill: color }));
      container.appendChild(svg);
    },

    donutMini: function (container, value, total, color) {
      container.innerHTML = "";
      var pct = total > 0 ? Math.min(1, value / total) : 0;
      var r = 26, c = 2 * Math.PI * r;
      var svg = svgEl("svg", { width: 64, height: 64, viewBox: "0 0 64 64" });
      svg.appendChild(svgEl("circle", { cx: 32, cy: 32, r: r, fill: "none", stroke: "#e6e2e4", "stroke-width": 8 }));
      var circle = svgEl("circle", {
        cx: 32, cy: 32, r: r, fill: "none", stroke: color, "stroke-width": 8,
        "stroke-dasharray": c, "stroke-dashoffset": c * (1 - pct), "stroke-linecap": "round",
        transform: "rotate(-90 32 32)"
      });
      svg.appendChild(circle);
      container.appendChild(svg);
    }
  };

  function truncateLabel(label, widthPx) {
    var maxChars = Math.max(4, Math.floor(widthPx / 6.4));
    if (label.length <= maxChars) return label;
    return label.slice(0, maxChars - 1) + "…";
  }

  function roundedTopRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    if (h <= r) r = h;
    return "M " + x + "," + (y + h) +
      " L " + x + "," + (y + r) +
      " Q " + x + "," + y + " " + (x + r) + "," + y +
      " L " + (x + w - r) + "," + y +
      " Q " + (x + w) + "," + y + " " + (x + w) + "," + (y + r) +
      " L " + (x + w) + "," + (y + h) + " Z";
  }

  global.Charts = Charts;
})(window);
