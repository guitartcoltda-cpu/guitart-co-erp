/* ============================================================
   Salão ERP — Consumo de Insumos (custo dividido 50/50)
   Módulo compartilhado usado pela Agenda (ao concluir um
   atendimento) e pelo Estoque (lançamento manual): registra o
   consumo de um produto de uso interno medido em ml/g, deduz do
   estoque, gera a metade do custo como despesa real da empresa e
   deixa a outra metade disponível para reduzir o "Devido" do
   profissional no comissionamento (ver Utils.consumoDeductionFor
   usado em comissoes.js / extrato-comissao.js).
   ============================================================ */
(function (global) {
  "use strict";

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // Quanto custa 1 ml/g (ou 1 unidade, se o produto não tiver embalagem
  // cadastrada) — a partir do preço de custo da embalagem comprada.
  function unitCostOf(product) {
    var size = Number(product.packageSize) || 0;
    if (size > 0 && (product.packageUnit === "ml" || product.packageUnit === "g")) {
      return (Number(product.costPrice) || 0) / size;
    }
    return Number(product.costPrice) || 0;
  }

  function unitLabelOf(product) {
    if (product.packageUnit === "ml" || product.packageUnit === "g") return product.packageUnit;
    return product.unit || "un";
  }

  // Formata uma quantidade consumida para exibição, convertendo
  // automaticamente para a unidade "maior" quando passa de 1000 — g vira
  // kg, ml vira L. Unidades que não são de medida (ex.: "un", "pct")
  // não são convertidas, só formatadas.
  function fmtQty(quantity, unit) {
    var q = Number(quantity) || 0;
    if (unit === "g" && q >= 1000) return Utils.fmtNumber(q / 1000, 2) + " kg";
    if (unit === "ml" && q >= 1000) return Utils.fmtNumber(q / 1000, 2) + " L";
    return Utils.fmtNumber(q, q % 1 ? 2 : 0) + " " + unit;
  }

  function consumoCategoria() {
    return DB.findOne("categories", function (c) { return c.name === "Produtos e Insumos"; }) ||
      DB.findOne("categories", function (c) { return /insumo/i.test(c.name); });
  }

  var Consumo = {
    unitCostOf: unitCostOf,
    unitLabelOf: unitLabelOf,
    fmtQty: fmtQty,

    // Lista os produtos elegíveis para lançamento de consumo (uso interno).
    produtosElegiveis: function () {
      return DB.all("products").filter(function (p) { return p.type === "uso_interno"; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
    },

    // opts: { productId, employeeId, quantity, appointmentId?, clientId?, date?, notes?, unitPriceOverride? }
    // `unitPriceOverride`, quando informado, substitui o preço de custo por
    // ml/g/unidade calculado a partir da embalagem — usado pela tela
    // "Lançar Consumo" do Estoque, que parte do preço de venda normal do
    // produto (com desconto opcional só ali, ver estoque.js) em vez do
    // custo de compra. O restante do sistema (ex.: Agenda ao concluir um
    // atendimento) continua usando o custo de compra, sem essa opção.
    // Lança 1 consumo. Lança exceção (string) em caso de dado inválido —
    // quem chama deve envolver em try/catch e mostrar via Toast.
    register: function (opts) {
      var product = DB.get("products", opts.productId);
      if (!product) throw "Produto não encontrado";
      var quantity = Number(opts.quantity) || 0;
      if (quantity <= 0) throw "Informe uma quantidade válida";
      var employee = opts.employeeId ? DB.get("employees", opts.employeeId) : null;

      var unitCost = opts.unitPriceOverride != null ? Number(opts.unitPriceOverride) || 0 : unitCostOf(product);
      var totalCost = round2(unitCost * quantity);
      var employeeShare = round2(totalCost / 2);
      var companyShare = round2(totalCost - employeeShare);
      var date = opts.date || Utils.todayISO();

      var record = null;
      DB.batch(function () {
        record = DB.insert("productConsumptions", {
          productId: product.id, employeeId: opts.employeeId || null, appointmentId: opts.appointmentId || null,
          clientId: opts.clientId || null, quantity: quantity, unit: unitLabelOf(product),
          unitCost: Math.round(unitCost * 10000) / 10000, totalCost: totalCost,
          employeeShare: employeeShare, companyShare: companyShare, date: date, notes: opts.notes || ""
        });

        var packageSize = Number(product.packageSize) || 0;
        var stockDelta = (packageSize > 0 && (product.packageUnit === "ml" || product.packageUnit === "g"))
          ? quantity / packageSize
          : quantity;
        var newStock = Math.max(0, Math.round(((Number(product.currentStock) || 0) - stockDelta) * 1000) / 1000);
        DB.update("products", product.id, { currentStock: newStock });

        DB.insert("stockMovements", {
          productId: product.id, type: "saida", reason: "consumo",
          quantity: Math.round(stockDelta * 1000) / 1000, date: date,
          // quantity acima está em "unidades de embalagem" (o mesmo padrão
          // usado por compra/venda/ajuste, para bater com currentStock) —
          // mas isso confunde quem lançou "100g" e vê "0,1 un" na tabela de
          // Movimentações. displayQuantity/displayUnit guardam o valor como
          // a pessoa realmente digitou (ex.: 100 g), só para exibição.
          displayQuantity: quantity, displayUnit: unitLabelOf(product),
          notes: "Consumo de insumo" + (employee ? " — " + employee.name : "") + (opts.notes ? " (" + opts.notes + ")" : ""),
          relatedConsumptionId: record.id
        });

        if (companyShare > 0) {
          var category = consumoCategoria();
          var costCenter = DB.findOne("costCenters", function (c) { return c.key === "operacional"; });
          DB.insert("transactions", {
            type: "despesa", description: "Consumo de insumo — " + product.name + (employee ? " (" + employee.name + ")" : ""),
            amount: companyShare, date: date,
            categoryId: category ? category.id : null, costCenterId: costCenter ? costCenter.id : null,
            paymentMethod: "Uso Interno", status: "pago", employeeId: opts.employeeId || null,
            appointmentId: opts.appointmentId || null, reconciled: false
          });
        }
      });

      DB.log("Estoque", "Registrou consumo de " + quantity + unitLabelOf(product) + " de " + product.name +
        (employee ? " para " + employee.name : "") + " — total " + Utils.fmtMoney(totalCost) + " (metade empresa, metade profissional)");

      return record;
    },

    // Remove um lançamento de consumo e o movimento de estoque associado,
    // devolvendo a quantidade ao estoque (a despesa da empresa já lançada
    // fica no histórico financeiro — se precisar estornar, é feito lá,
    // como qualquer outro lançamento).
    remove: function (id) {
      var record = DB.get("productConsumptions", id);
      if (!record) return false;
      var product = DB.get("products", record.productId);
      DB.batch(function () {
        if (product) {
          var packageSize = Number(product.packageSize) || 0;
          var stockDelta = (packageSize > 0 && (product.packageUnit === "ml" || product.packageUnit === "g"))
            ? record.quantity / packageSize
            : record.quantity;
          DB.update("products", product.id, { currentStock: round2((Number(product.currentStock) || 0) + stockDelta) });
        }
        DB.removeWhere("stockMovements", function (m) { return m.relatedConsumptionId === id; });
        DB.remove("productConsumptions", id);
      });
      DB.log("Estoque", "Removeu um lançamento de consumo de insumo" + (product ? " (" + product.name + ")" : ""));
      return true;
    },

    // Aplica um desconto (em R$) sobre um lançamento de consumo já salvo,
    // reduzindo o custo total e recalculando a divisão 50/50. Usado tanto
    // quando um Administrador dá desconto direto na tela de Estoque quanto
    // quando uma solicitação de desconto é aprovada em Configurações →
    // Aprovações (ver assets/js/approvals.js e configuracoes.js).
    applyDiscount: function (consumptionId, discountAmount) {
      var c = DB.get("productConsumptions", consumptionId);
      if (!c) return null;
      var discount = Math.max(0, Number(discountAmount) || 0);
      var newTotal = Math.max(0, round2(c.totalCost - discount));
      var employeeShare = round2(newTotal / 2);
      var companyShare = round2(newTotal - employeeShare);
      return DB.update("productConsumptions", consumptionId, {
        totalCost: newTotal, employeeShare: employeeShare, companyShare: companyShare,
        discountApplied: round2((Number(c.discountApplied) || 0) + discount)
      });
    },

    // Soma a metade (do profissional) do consumo de insumos de um
    // funcionário num mês — usado para reduzir o "Devido" no comissionamento.
    deductionFor: function (employeeId, monthKey) {
      var items = DB.all("productConsumptions").filter(function (c) {
        return c.employeeId === employeeId && Utils.monthKey(c.date) === monthKey;
      });
      var total = items.reduce(function (s, c) { return s + (Number(c.employeeShare) || 0); }, 0);
      return { total: round2(total), items: items };
    },

    // Mesma soma, mas por um intervalo de datas (início/fim ISO, ambos
    // inclusive) em vez de um mês calendário inteiro — usado no
    // comissionamento com corte de data personalizado (profissionais pagos
    // semanal/quinzenal). Como productConsumptions já guarda uma data real
    // por lançamento, o filtro é exato, sem aproximação por mês.
    deductionForRange: function (employeeId, range) {
      var items = DB.all("productConsumptions").filter(function (c) {
        return c.employeeId === employeeId && c.date >= range.start && c.date <= range.end;
      });
      var total = items.reduce(function (s, c) { return s + (Number(c.employeeShare) || 0); }, 0);
      return { total: round2(total), items: items };
    }
  };

  global.Consumo = Consumo;
})(window);
