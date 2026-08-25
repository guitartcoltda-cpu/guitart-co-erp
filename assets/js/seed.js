/* ============================================================
   Salão ERP — Gerador de dados fictícios
   Gera ~9 meses de histórico: funcionários, clientes, centros de
   custo, categorias, serviços, produtos/estoque, agendamentos,
   lançamentos financeiros e linhas de extrato bancário (histórico
   já conciliado), deixando os últimos ~45 dias em aberto para o
   usuário testar a conciliação bancária manualmente.
   ============================================================ */

(function (global) {
  "use strict";

  // ---------------- RNG helpers ----------------
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randFloat(min, max, decimals) {
    var v = Math.random() * (max - min) + min;
    var d = decimals === undefined ? 2 : decimals;
    return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
  function pickWeighted(items) {
    // items: [{v, w}]
    var total = items.reduce(function (s, i) { return s + i.w; }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < items.length; i++) {
      r -= items[i].w;
      if (r <= 0) return items[i].v;
    }
    return items[items.length - 1].v;
  }
  function chance(pct) { return Math.random() * 100 < pct; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Gera um CPF fictício com dígitos verificadores válidos (mesmo algoritmo
  // de Utils.isValidCPF), para os funcionários poderem logar de verdade e a
  // tela de Extrato do Profissional conseguir restringir por CPF+Usuário.
  function randomCPF() {
    var base = [];
    for (var i = 0; i < 9; i++) base.push(randInt(0, 9));
    function digit(nums, factorStart) {
      var sum = 0;
      for (var i = 0; i < nums.length; i++) sum += nums[i] * (factorStart - i);
      var d = (sum * 10) % 11;
      return d === 10 ? 0 : d;
    }
    var d1 = digit(base, 10);
    var d2 = digit(base.concat([d1]), 11);
    return base.concat([d1, d2]).join("");
  }

  // ---------------- Name banks ----------------
  var FEMALE_NAMES = ["Fernanda", "Juliana", "Patrícia", "Camila", "Aline", "Beatriz", "Larissa", "Sabrina",
    "Débora", "Mariana", "Renata", "Carla", "Bruna", "Vanessa", "Priscila", "Amanda", "Tatiane", "Gabriela",
    "Letícia", "Cristiane", "Rafaela", "Simone", "Adriana", "Luciana", "Daniela", "Fabiana", "Viviane",
    "Andréa", "Karina", "Roberta", "Natália", "Michele", "Alessandra", "Elaine", "Kelly", "Sandra", "Cíntia",
    "Márcia", "Silvana", "Jéssica", "Paula", "Solange", "Eliane", "Regina", "Sônia", "Verônica", "Ingrid"];
  var MALE_NAMES = ["Rodrigo", "Marcos", "Diego", "Lucas", "Bruno", "André", "Felipe", "Gustavo", "Thiago",
    "Rafael", "Eduardo", "Vinícius", "Leonardo", "Ricardo", "Fábio", "Alexandre", "Daniel", "Marcelo",
    "Paulo", "Renato", "Sérgio", "Wagner", "César", "Hugo", "Igor", "José", "Antônio"];
  var LAST_NAMES = ["Souza", "Ramos", "Lima", "Duarte", "Ferreira", "Nogueira", "Martins", "Costa", "Santos",
    "Pereira", "Oliveira", "Silva", "Almeida", "Carvalho", "Gomes", "Barbosa", "Rocha", "Dias", "Cardoso",
    "Teixeira", "Correia", "Machado", "Nunes", "Moreira", "Araújo", "Castro", "Batista", "Vieira", "Monteiro",
    "Pinto", "Freitas", "Cavalcanti", "Azevedo", "Melo", "Reis", "Fonseca", "Andrade", "Campos", "Farias"];

  function randomFullName(gender) {
    var first = gender === "M" ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
    var last = pick(LAST_NAMES) + (chance(45) ? " " + pick(LAST_NAMES) : "");
    return first + " " + last;
  }
  function randomPhone() {
    return "(11) 9" + randInt(6000, 9999) + "-" + randInt(1000, 9999);
  }
  function randomEmail(name) {
    var base = Utils.slugify(name).replace(/-/g, ".");
    var domain = pick(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br"]);
    return base + randInt(1, 99) + "@" + domain;
  }

  // ---------------- Static reference data ----------------
  function buildCostCenters() {
    return [
      { key: "operacional", name: "Operacional - Salão", description: "Atendimentos, insumos e consumo direto do salão" },
      { key: "comercial", name: "Comercial - Vendas", description: "Venda de produtos de revenda aos clientes" },
      { key: "administrativo", name: "Administrativo", description: "Aluguel, contabilidade, taxas, estrutura geral" },
      { key: "rh", name: "Recursos Humanos", description: "Salários, comissões e benefícios da equipe" },
      { key: "marketing", name: "Marketing", description: "Divulgação, redes sociais e publicidade" },
      { key: "manutencao", name: "Manutenção e Infraestrutura", description: "Reparos, limpeza e conservação do espaço" }
    ].map(function (c) { return Object.assign({ id: DB.uid("cc") }, c); });
  }

  function buildCategories(cc) {
    function ccId(key) { return cc.find(function (c) { return c.key === key; }).id; }
    var list = [
      { name: "Serviços - Cabelo", type: "receita", costCenterId: ccId("operacional"), color: "#52525a" },
      { name: "Serviços - Unhas", type: "receita", costCenterId: ccId("operacional"), color: "#c76b8c" },
      { name: "Serviços - Estética", type: "receita", costCenterId: ccId("operacional"), color: "#9c5fb0" },
      { name: "Serviços - Maquiagem", type: "receita", costCenterId: ccId("operacional"), color: "#7d5fb0" },
      { name: "Venda de Produtos", type: "receita", costCenterId: ccId("comercial"), color: "#b8923f" },
      { name: "Outras Receitas", type: "receita", costCenterId: ccId("administrativo"), color: "#8a8a8a" },

      { name: "Aluguel", type: "despesa", costCenterId: ccId("administrativo"), color: "#c23b3b" },
      { name: "Água, Luz e Internet", type: "despesa", costCenterId: ccId("administrativo"), color: "#2f6fa8" },
      { name: "Salários", type: "despesa", costCenterId: ccId("rh"), color: "#b7791f" },
      { name: "Comissões", type: "despesa", costCenterId: ccId("rh"), color: "#d19a3c" },
      { name: "Benefícios (VT/VR)", type: "despesa", costCenterId: ccId("rh"), color: "#c98f5c" },
      { name: "Produtos e Insumos", type: "despesa", costCenterId: ccId("operacional"), color: "#8b4a63" },
      { name: "Produtos para Revenda (compra)", type: "despesa", costCenterId: ccId("comercial"), color: "#a97a2f" },
      { name: "Marketing e Publicidade", type: "despesa", costCenterId: ccId("marketing"), color: "#6f4fa0" },
      { name: "Manutenção e Reparos", type: "despesa", costCenterId: ccId("manutencao"), color: "#5c7a5c" },
      { name: "Limpeza e Higiene", type: "despesa", costCenterId: ccId("manutencao"), color: "#4f8a7a" },
      { name: "Materiais de Escritório", type: "despesa", costCenterId: ccId("administrativo"), color: "#7a7a7a" },
      { name: "Contabilidade", type: "despesa", costCenterId: ccId("administrativo"), color: "#4f6d8a" },
      { name: "Software e Assinaturas", type: "despesa", costCenterId: ccId("administrativo"), color: "#4f8ab0" },
      { name: "Impostos e Taxas", type: "despesa", costCenterId: ccId("administrativo"), color: "#a04f4f" },
      { name: "Outras Despesas", type: "despesa", costCenterId: ccId("administrativo"), color: "#8a8a8a" }
    ];
    return list.map(function (c) { return Object.assign({ id: DB.uid("cat") }, c); });
  }

  function buildServices(cat) {
    function catId(name) { return cat.find(function (c) { return c.name === name; }).id; }
    var list = [
      { name: "Corte Feminino", group: "Cabelo", price: 80, durationMin: 50 },
      { name: "Corte Masculino", group: "Cabelo", price: 45, durationMin: 30 },
      { name: "Escova", group: "Cabelo", price: 60, durationMin: 40 },
      { name: "Hidratação Capilar", group: "Cabelo", price: 90, durationMin: 50 },
      { name: "Coloração", group: "Cabelo", price: 180, durationMin: 120 },
      { name: "Luzes / Mechas", group: "Cabelo", price: 250, durationMin: 150 },
      { name: "Progressiva / Alisamento", group: "Cabelo", price: 220, durationMin: 130 },
      { name: "Penteado para Festa", group: "Cabelo", price: 150, durationMin: 60 },
      { name: "Manicure", group: "Unhas", price: 35, durationMin: 40 },
      { name: "Pedicure", group: "Unhas", price: 45, durationMin: 50 },
      { name: "Manicure + Pedicure", group: "Unhas", price: 70, durationMin: 80 },
      { name: "Unha em Gel", group: "Unhas", price: 90, durationMin: 90 },
      { name: "Limpeza de Pele", group: "Estética", price: 120, durationMin: 60 },
      { name: "Design de Sobrancelha", group: "Estética", price: 30, durationMin: 20 },
      { name: "Depilação Perna Completa", group: "Estética", price: 80, durationMin: 40 },
      { name: "Depilação Buço/Sobrancelha", group: "Estética", price: 25, durationMin: 15 },
      { name: "Massagem Relaxante", group: "Estética", price: 140, durationMin: 60 },
      { name: "Maquiagem Social", group: "Maquiagem", price: 120, durationMin: 60 },
      { name: "Maquiagem para Noiva", group: "Maquiagem", price: 280, durationMin: 90 }
    ];
    var groupToCat = { "Cabelo": "Serviços - Cabelo", "Unhas": "Serviços - Unhas", "Estética": "Serviços - Estética", "Maquiagem": "Serviços - Maquiagem" };
    return list.map(function (s) {
      return Object.assign({ id: DB.uid("srv"), categoryId: catId(groupToCat[s.group]) }, s);
    });
  }

  var ROLE_GROUP = {
    "Cabeleireiro(a)": "Cabelo",
    "Manicure e Pedicure": "Unhas",
    "Esteticista": "Estética",
    "Maquiador(a)": "Maquiagem"
  };

  function buildEmployees() {
    var defs = [
      { name: "Fernanda Souza", role: "Cabeleireiro(a)", gender: "F", commissionRate: 38, baseSalary: 500, hireMonthsAgo: 30 },
      { name: "Juliana Ramos", role: "Cabeleireiro(a)", gender: "F", commissionRate: 36, baseSalary: 500, hireMonthsAgo: 22 },
      { name: "Patrícia Lima", role: "Cabeleireiro(a)", gender: "F", commissionRate: 33, baseSalary: 400, hireMonthsAgo: 8 },
      { name: "Diego Pereira", role: "Cabeleireiro(a)", gender: "M", commissionRate: 35, baseSalary: 400, hireMonthsAgo: 14 },
      { name: "Camila Duarte", role: "Manicure e Pedicure", gender: "F", commissionRate: 42, baseSalary: 350, hireMonthsAgo: 26 },
      { name: "Aline Ferreira", role: "Manicure e Pedicure", gender: "F", commissionRate: 40, baseSalary: 350, hireMonthsAgo: 11 },
      { name: "Beatriz Nogueira", role: "Esteticista", gender: "F", commissionRate: 38, baseSalary: 400, hireMonthsAgo: 18 },
      { name: "Larissa Martins", role: "Esteticista", gender: "F", commissionRate: 36, baseSalary: 350, hireMonthsAgo: 6 },
      { name: "Rodrigo Alves", role: "Maquiador(a)", gender: "M", commissionRate: 33, baseSalary: 300, hireMonthsAgo: 9 },
      { name: "Sabrina Costa", role: "Recepcionista", gender: "F", commissionRate: 0, baseSalary: 1700, hireMonthsAgo: 20 },
      { name: "Marcos Vinícius Tavares", role: "Gerente", gender: "M", commissionRate: 0, baseSalary: 3500, hireMonthsAgo: 36 },
      { name: "Débora Santos", role: "Financeiro/Administrativo", gender: "F", commissionRate: 0, baseSalary: 2400, hireMonthsAgo: 15 }
    ];
    var today = Utils.todayISO();
    return defs.map(function (d) {
      var birthMonth = randInt(1, 12), birthDay = randInt(1, 28);
      return {
        id: DB.uid("emp"),
        name: d.name,
        role: d.role,
        phone: randomPhone(),
        email: randomEmail(d.name),
        cpf: randomCPF(),
        photoDataUrl: null,
        birthday: String(randInt(1978, 2002)) + "-" + String(birthMonth).padStart(2, "0") + "-" + String(birthDay).padStart(2, "0"),
        hireDate: Utils.addMonths(today, -d.hireMonthsAgo),
        status: "ativo",
        commissionRate: d.commissionRate,
        baseSalary: d.baseSalary
      };
    });
  }

  function buildClients(n) {
    var tagsPool = ["fiel", "vip", "aniversariante", "indicação", "novo", "corporativo"];
    var out = [];
    var today = Utils.todayISO();
    for (var i = 0; i < n; i++) {
      var gender = chance(88) ? "F" : "M";
      var name = randomFullName(gender);
      var firstVisitMonthsAgo = randInt(0, 11);
      var birthMonth = randInt(1, 12), birthDay = randInt(1, 28);
      out.push({
        id: DB.uid("cli"),
        name: name,
        phone: randomPhone(),
        email: randomEmail(name),
        birthday: String(randInt(1975, 2005)) + "-" + String(birthMonth).padStart(2, "0") + "-" + String(birthDay).padStart(2, "0"),
        firstVisit: Utils.addMonths(today, -firstVisitMonthsAgo),
        notes: "",
        tags: [pick(tagsPool)].concat(chance(20) ? [pick(tagsPool)] : []).filter(function (v, idx, a) { return a.indexOf(v) === idx; })
      });
    }
    return out;
  }

  function buildProducts() {
    // packageSize/packageUnit descrevem quanto vem em 1 unidade comprada
    // (ex.: 1 "Shampoo Profissional 1L" = 1000ml) — é o que permite lançar
    // consumo fracionado em ml/g (Registrar Consumo de Insumo) e calcular o
    // custo proporcional. Itens vendidos/consumidos por unidade inteira
    // (luvas, papel alumínio, algodão, espátulas, toalhas) não têm
    // packageUnit ml/g — o consumo deles é lançado em unidades mesmo.
    // salePrice aqui é o preço de venda normal do item, usado como base do
    // valor no lançamento de Consumo de Insumos (ver estoque.js
    // consumoItemRowHtml) — mesmo sendo produtos de uso interno, o salão
    // "cobra" internamente pelo preço de venda normal, com desconto
    // opcional só naquela tela.
    var interno = [
      { name: "Shampoo Profissional 1L", unit: "un", costPrice: 32, salePrice: 79.9, supplier: "Distribuidora Beauty Pro", packageSize: 1000, packageUnit: "ml" },
      { name: "Condicionador Profissional 1L", unit: "un", costPrice: 34, salePrice: 84.9, supplier: "Distribuidora Beauty Pro", packageSize: 1000, packageUnit: "ml" },
      { name: "Máscara de Hidratação 1kg", unit: "un", costPrice: 58, salePrice: 144.9, supplier: "Distribuidora Beauty Pro", packageSize: 1000, packageUnit: "g" },
      { name: "Coloração Profissional - Tubo 60g", unit: "un", costPrice: 18, salePrice: 44.9, supplier: "Cosméticos Cor & Cia", packageSize: 60, packageUnit: "g" },
      { name: "Água Oxigenada 900ml (20 vol.)", unit: "un", costPrice: 14, salePrice: 34.9, supplier: "Cosméticos Cor & Cia", packageSize: 900, packageUnit: "ml" },
      { name: "Pó Descolorante 500g", unit: "un", costPrice: 42, salePrice: 104.9, supplier: "Cosméticos Cor & Cia", packageSize: 500, packageUnit: "g" },
      { name: "Luvas Descartáveis (cx 100un)", unit: "cx", costPrice: 22, salePrice: 54.9, supplier: "Distribuidora Higiene Total" },
      { name: "Papel Alumínio para Salão (rolo)", unit: "un", costPrice: 26, salePrice: 64.9, supplier: "Distribuidora Beauty Pro" },
      { name: "Algodão (pacote 500g)", unit: "pct", costPrice: 12, salePrice: 29.9, supplier: "Distribuidora Higiene Total" },
      { name: "Removedor de Esmalte 500ml", unit: "un", costPrice: 9, salePrice: 22.9, supplier: "Distribuidora Unhas & Cia", packageSize: 500, packageUnit: "ml" },
      { name: "Cera de Depilação 1kg", unit: "un", costPrice: 38, salePrice: 94.9, supplier: "Distribuidora Beauty Pro", packageSize: 1000, packageUnit: "g" },
      { name: "Espátulas Descartáveis (pct 100un)", unit: "pct", costPrice: 15, salePrice: 37.9, supplier: "Distribuidora Higiene Total" },
      { name: "Toalhas Descartáveis (pct 50un)", unit: "pct", costPrice: 28, salePrice: 69.9, supplier: "Distribuidora Higiene Total" },
      { name: "Protetor Térmico Uso Profissional 500ml", unit: "un", costPrice: 24, salePrice: 59.9, supplier: "Cosméticos Cor & Cia", packageSize: 500, packageUnit: "ml" }
    ];
    var revenda = [
      { name: "Shampoo Linha Profissional 300ml", unit: "un", costPrice: 24, salePrice: 59.9, supplier: "Distribuidora Beauty Pro" },
      { name: "Condicionador Linha Profissional 300ml", unit: "un", costPrice: 25, salePrice: 62.9, supplier: "Distribuidora Beauty Pro" },
      { name: "Máscara Capilar 250g", unit: "un", costPrice: 30, salePrice: 79.9, supplier: "Distribuidora Beauty Pro" },
      { name: "Óleo Finalizador 60ml", unit: "un", costPrice: 22, salePrice: 54.9, supplier: "Cosméticos Cor & Cia" },
      { name: "Protetor Térmico Spray 200ml", unit: "un", costPrice: 20, salePrice: 49.9, supplier: "Cosméticos Cor & Cia" },
      { name: "Esmalte Coleção Especial", unit: "un", costPrice: 6, salePrice: 16.9, supplier: "Distribuidora Unhas & Cia" },
      { name: "Kit Manicure para Casa", unit: "kit", costPrice: 18, salePrice: 44.9, supplier: "Distribuidora Unhas & Cia" },
      { name: "Sérum Facial Vitamina C 30ml", unit: "un", costPrice: 28, salePrice: 89.9, supplier: "Cosméticos Cor & Cia" },
      { name: "Protetor Solar Facial FPS 50", unit: "un", costPrice: 26, salePrice: 69.9, supplier: "Cosméticos Cor & Cia" },
      { name: "Escova de Cabelo Profissional", unit: "un", costPrice: 15, salePrice: 39.9, supplier: "Distribuidora Beauty Pro" }
    ];
    var out = [];
    interno.forEach(function (p) {
      var min = randInt(6, 14);
      var stock = chance(18) ? randInt(0, min - 1) : randInt(min, min * 4);
      out.push(Object.assign({ id: DB.uid("prd"), type: "uso_interno", minStock: min, currentStock: stock, sku: "UI-" + DB.uid("").toUpperCase() }, p));
    });
    revenda.forEach(function (p) {
      var min = randInt(4, 10);
      var stock = chance(18) ? randInt(0, min - 1) : randInt(min, min * 5);
      out.push(Object.assign({ id: DB.uid("prd"), type: "revenda", minStock: min, currentStock: stock, sku: "RV-" + DB.uid("").toUpperCase() }, p));
    });
    return out;
  }

  // ---------------- Core generation ----------------
  function run() {
    DB.resetAll();

    var costCenters = buildCostCenters();
    var categories = buildCategories(costCenters);
    var services = buildServices(categories);
    var employees = buildEmployees();
    var clients = buildClients(52);
    var products = buildProducts();

    function ccByKey(key) { return costCenters.find(function (c) { return c.key === key; }).id; }
    function catByName(name) { return categories.find(function (c) { return c.name === name; }).id; }
    var employeesByGroup = {};
    ["Cabelo", "Unhas", "Estética", "Maquiagem"].forEach(function (g) {
      employeesByGroup[g] = employees.filter(function (e) { return ROLE_GROUP[e.role] === g; });
    });
    var internoProducts = products.filter(function (p) { return p.type === "uso_interno"; });
    var revendaProducts = products.filter(function (p) { return p.type === "revenda"; });

    var today = Utils.todayISO();
    var startDate = Utils.addMonths(today, -6);

    var transactions = [];
    var appointments = [];
    var stockMovements = [];

    var PAYMENT_RECEITA = [{ v: "Pix", w: 35 }, { v: "Cartão de Crédito", w: 30 }, { v: "Cartão de Débito", w: 20 }, { v: "Dinheiro", w: 15 }];
    var PAYMENT_DESPESA = [{ v: "Transferência", w: 45 }, { v: "Boleto", w: 25 }, { v: "Cartão de Crédito", w: 15 }, { v: "Pix", w: 15 }];

    function addStockQty(productId, delta) {
      var p = products.find(function (x) { return x.id === productId; });
      if (p) p.currentStock = Math.max(0, round2(p.currentStock + delta));
    }

    // ---- 1) Histórico de agendamentos + receitas + consumo de estoque ----
    var d = startDate;
    while (Utils.daysBetween(d, today) >= 0) {
      var dow = Utils.parseDate(d).getDay(); // 0=domingo
      if (dow !== 0) {
        var weight = dow === 1 ? 0.6 : (dow === 6 ? 1.4 : (dow === 5 ? 1.2 : 0.9));
        var count = Math.max(1, Math.round(randInt(7, 13) * weight));
        for (var i = 0; i < count; i++) {
          var service = pick(services);
          var group = services.find(function (s) { return s.id === service.id; });
          var groupName = group.group;
          var candidateEmployees = employeesByGroup[groupName];
          if (!candidateEmployees || !candidateEmployees.length) continue;
          var employee = pick(candidateEmployees);
          var client = pick(clients);
          var hour = randInt(9, 18);
          var minute = pick([0, 15, 30, 45]);
          var time = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
          var isToday = d === today;
          var isPastTime = isToday ? (hour < new Date().getHours()) : true;
          var status = "concluido";
          if (isToday && !isPastTime) status = "agendado";
          if (chance(4)) status = "cancelado";

          var priceVar = round2(service.price * randFloat(0.92, 1.08));
          var appt = {
            id: DB.uid("apt"),
            date: d, time: time,
            clientId: client.id, employeeId: employee.id, serviceId: service.id,
            status: status, price: priceVar
          };
          appointments.push(appt);

          if (status === "concluido") {
            var payMethod = pickWeighted(PAYMENT_RECEITA);
            var catId = { "Cabelo": "Serviços - Cabelo", "Unhas": "Serviços - Unhas", "Estética": "Serviços - Estética", "Maquiagem": "Serviços - Maquiagem" }[groupName];
            transactions.push({
              id: DB.uid("txn"), date: d, type: "receita",
              description: service.name + " - " + client.name,
              amount: priceVar, categoryId: catByName(catId), costCenterId: ccByKey("operacional"),
              paymentMethod: payMethod, status: "pago",
              employeeId: employee.id, clientId: client.id, appointmentId: appt.id,
              reconciled: false
            });

            // consumo interno de produtos
            if (chance(42) && internoProducts.length) {
              var usedProd = pick(internoProducts);
              var qty = round2(randFloat(0.05, 1, 2));
              stockMovements.push({
                id: DB.uid("stk"), productId: usedProd.id, type: "saida", quantity: qty,
                reason: "uso_interno", date: d, notes: "Consumo em atendimento: " + service.name,
                relatedTransactionId: null
              });
              addStockQty(usedProd.id, -qty);
            }

            // venda de produto de revenda associada ao atendimento
            if (chance(26) && revendaProducts.length) {
              var soldProd = pick(revendaProducts);
              var qty2 = chance(20) ? 2 : 1;
              var saleAmount = round2(soldProd.salePrice * qty2);
              var saleTxn = {
                id: DB.uid("txn"), date: d, type: "receita",
                description: "Venda de produto - " + soldProd.name + (qty2 > 1 ? " (x" + qty2 + ")" : ""),
                amount: saleAmount, categoryId: catByName("Venda de Produtos"), costCenterId: ccByKey("comercial"),
                paymentMethod: pickWeighted(PAYMENT_RECEITA), status: "pago",
                employeeId: employee.id, clientId: client.id, productId: soldProd.id,
                reconciled: false
              };
              transactions.push(saleTxn);
              stockMovements.push({
                id: DB.uid("stk"), productId: soldProd.id, type: "saida", quantity: qty2,
                reason: "venda", date: d, notes: "Venda ao cliente " + client.name,
                relatedTransactionId: saleTxn.id
              });
              addStockQty(soldProd.id, -qty2);
            }
          }
        }
      }
      d = Utils.addDays(d, 1);
    }

    // ---- 2) Agendamentos futuros (próximos 12 dias) ----
    for (var f = 1; f <= 12; f++) {
      var fd = Utils.addDays(today, f);
      var fdow = Utils.parseDate(fd).getDay();
      if (fdow === 0) continue;
      var fcount = randInt(3, 8);
      for (var j = 0; j < fcount; j++) {
        var fservice = pick(services);
        var fgroupName = fservice.group;
        var fcands = employeesByGroup[fgroupName];
        if (!fcands || !fcands.length) continue;
        var femployee = pick(fcands);
        var fclient = pick(clients);
        var fhour = randInt(9, 18), fminute = pick([0, 15, 30, 45]);
        appointments.push({
          id: DB.uid("apt"), date: fd,
          time: String(fhour).padStart(2, "0") + ":" + String(fminute).padStart(2, "0"),
          clientId: fclient.id, employeeId: femployee.id, serviceId: fservice.id,
          status: "agendado", price: round2(fservice.price * randFloat(0.95, 1.05))
        });
      }
    }

    // ---- 3) Receita mensal (para impostos e comissões) ----
    function monthsList() {
      var out = [];
      var cursor = startDate.slice(0, 7);
      var last = today.slice(0, 7);
      while (cursor <= last) {
        out.push(cursor);
        var parts = cursor.split("-").map(Number);
        parts[1] += 1;
        if (parts[1] > 12) { parts[1] = 1; parts[0] += 1; }
        cursor = parts[0] + "-" + String(parts[1]).padStart(2, "0");
      }
      return out;
    }
    var months = monthsList();

    function monthRevenue(mk) {
      return transactions.filter(function (t) { return t.type === "receita" && Utils.monthKey(t.date) === mk; })
        .reduce(function (s, t) { return s + t.amount; }, 0);
    }
    function employeeMonthServiceRevenue(empId, mk) {
      return transactions.filter(function (t) {
        return t.type === "receita" && t.employeeId === empId && Utils.monthKey(t.date) === mk && !t.productId;
      }).reduce(function (s, t) { return s + t.amount; }, 0);
    }

    // ---- 4) Despesas recorrentes mensais ----
    var MARKETING_DESC = ["Anúncios Instagram/Facebook", "Panfletagem no bairro", "Parceria com influenciadora local", "Campanha Google Ads"];
    var MANUT_DESC = ["Conserto de secador profissional", "Manutenção do ar-condicionado", "Reparo hidráulico na recepção", "Pintura e retoques no salão", "Manutenção elétrica"];

    months.forEach(function (mk, mIdx) {
      var monthStart = mk + "-01";
      var inflFactor = 1 + mIdx * 0.006;

      function mdate(day) {
        var last = new Date(Number(mk.split("-")[0]), Number(mk.split("-")[1]), 0).getDate();
        return mk + "-" + String(Math.min(day, last)).padStart(2, "0");
      }
      function statusFor(dt) { return dt <= today ? "pago" : "pendente"; }

      // Aluguel
      var aluguelDate = mdate(5);
      transactions.push({ id: DB.uid("txn"), date: aluguelDate, type: "despesa", description: "Aluguel do salão - " + Utils.monthLabel(monthStart),
        amount: round2(4200 * inflFactor), categoryId: catByName("Aluguel"), costCenterId: ccByKey("administrativo"),
        paymentMethod: "Transferência", status: statusFor(aluguelDate), reconciled: false });

      // Água/Luz/Internet
      var utilDate = mdate(8);
      transactions.push({ id: DB.uid("txn"), date: utilDate, type: "despesa", description: "Água, luz e internet - " + Utils.monthLabel(monthStart),
        amount: round2(randFloat(320, 540)), categoryId: catByName("Água, Luz e Internet"), costCenterId: ccByKey("administrativo"),
        paymentMethod: "Boleto", status: statusFor(utilDate), reconciled: false });

      // Contabilidade
      var contDate = mdate(10);
      transactions.push({ id: DB.uid("txn"), date: contDate, type: "despesa", description: "Honorários contábeis - " + Utils.monthLabel(monthStart),
        amount: 450, categoryId: catByName("Contabilidade"), costCenterId: ccByKey("administrativo"),
        paymentMethod: "Boleto", status: statusFor(contDate), reconciled: false });

      // Software/Assinaturas
      var softDate = mdate(3);
      transactions.push({ id: DB.uid("txn"), date: softDate, type: "despesa", description: "Assinaturas de sistemas (agenda, financeiro, nota fiscal)",
        amount: 179, categoryId: catByName("Software e Assinaturas"), costCenterId: ccByKey("administrativo"),
        paymentMethod: "Cartão de Crédito", status: statusFor(softDate), reconciled: false });

      // Limpeza
      var limpDate = mdate(6);
      transactions.push({ id: DB.uid("txn"), date: limpDate, type: "despesa", description: "Serviço de limpeza terceirizada",
        amount: round2(randFloat(250, 380)), categoryId: catByName("Limpeza e Higiene"), costCenterId: ccByKey("manutencao"),
        paymentMethod: "Pix", status: statusFor(limpDate), reconciled: false });

      // Materiais de escritório
      if (chance(55)) {
        var offDate = mdate(randInt(10, 25));
        transactions.push({ id: DB.uid("txn"), date: offDate, type: "despesa", description: "Materiais de escritório e recepção",
          amount: round2(randFloat(60, 220)), categoryId: catByName("Materiais de Escritório"), costCenterId: ccByKey("administrativo"),
          paymentMethod: "Cartão de Débito", status: statusFor(offDate), reconciled: false });
      }

      // Marketing
      var mktDate = mdate(randInt(10, 18));
      transactions.push({ id: DB.uid("txn"), date: mktDate, type: "despesa", description: pick(MARKETING_DESC),
        amount: round2(randFloat(250, 700)), categoryId: catByName("Marketing e Publicidade"), costCenterId: ccByKey("marketing"),
        paymentMethod: "Cartão de Crédito", status: statusFor(mktDate), reconciled: false });

      // Manutenção (ocasional)
      if (chance(42)) {
        var manDate = mdate(randInt(5, 27));
        transactions.push({ id: DB.uid("txn"), date: manDate, type: "despesa", description: pick(MANUT_DESC),
          amount: round2(randFloat(150, 900)), categoryId: catByName("Manutenção e Reparos"), costCenterId: ccByKey("manutencao"),
          paymentMethod: "Pix", status: statusFor(manDate), reconciled: false });
      }

      // Salários
      var salDate = mdate(5);
      employees.filter(function (e) { return e.baseSalary > 0; }).forEach(function (e) {
        transactions.push({ id: DB.uid("txn"), date: salDate, type: "despesa", description: "Salário - " + e.name,
          amount: e.baseSalary, categoryId: catByName("Salários"), costCenterId: ccByKey("rh"),
          paymentMethod: "Transferência", status: statusFor(salDate), employeeId: e.id, reconciled: false });
      });

      // Benefícios (VT/VR) — apenas para quem tem salário fixo (equipe administrativa)
      var beneDate = mdate(5);
      var salariedCount = employees.filter(function (e) { return e.baseSalary >= 1000; }).length;
      transactions.push({ id: DB.uid("txn"), date: beneDate, type: "despesa", description: "Vale Transporte / Vale Refeição - Equipe Administrativa",
        amount: round2(salariedCount * 260), categoryId: catByName("Benefícios (VT/VR)"), costCenterId: ccByKey("rh"),
        paymentMethod: "Transferência", status: statusFor(beneDate), reconciled: false });

      // Compras de estoque (insumos + revenda) — prioriza produtos com estoque mais baixo
      var purchases = randInt(5, 8);
      for (var pI = 0; pI < purchases; pI++) {
        var useInterno = chance(60);
        var prodPool = useInterno ? internoProducts : revendaProducts;
        if (!prodPool.length) continue;
        var prod = chance(40)
          ? prodPool.slice().sort(function (x, y) { return (x.currentStock / (x.minStock || 1)) - (y.currentStock / (y.minStock || 1)); })[0]
          : pick(prodPool);
        var qty = useInterno ? randInt(4, 11) : randInt(5, 14);
        var amount = round2(prod.costPrice * qty);
        var purDate = mdate(randInt(1, 27));
        var catName = useInterno ? "Produtos e Insumos" : "Produtos para Revenda (compra)";
        var ccKey = useInterno ? "operacional" : "comercial";
        var purTxn = { id: DB.uid("txn"), date: purDate, type: "despesa",
          description: "Compra de estoque - " + prod.name + " (x" + qty + ") - " + prod.supplier,
          amount: amount, categoryId: catByName(catName), costCenterId: ccByKey(ccKey),
          paymentMethod: "Boleto", status: statusFor(purDate), productId: prod.id, reconciled: false };
        transactions.push(purTxn);
        stockMovements.push({ id: DB.uid("stk"), productId: prod.id, type: "entrada", quantity: qty,
          reason: "compra", date: purDate, notes: "Compra - " + prod.supplier, relatedTransactionId: purTxn.id });
        addStockQty(prod.id, qty);
      }

      // Garante ao menos um lançamento pendente no mês corrente (para demonstrar o status)
      if (mIdx === months.length - 1) {
        var futureDay = Utils.addDays(today, randInt(2, 6));
        if (Utils.monthKey(futureDay) === mk) {
          transactions.push({ id: DB.uid("txn"), date: futureDay, type: "despesa", description: "Reposição de insumos - pedido em aberto",
            amount: round2(randFloat(280, 620)), categoryId: catByName("Produtos e Insumos"), costCenterId: ccByKey("operacional"),
            paymentMethod: "Boleto", status: "pendente", reconciled: false });
        }
        var futureDay2 = Utils.addDays(today, randInt(3, 8));
        if (Utils.monthKey(futureDay2) === mk) {
          transactions.push({ id: DB.uid("txn"), date: futureDay2, type: "despesa", description: "Manutenção preventiva agendada",
            amount: round2(randFloat(180, 450)), categoryId: catByName("Manutenção e Reparos"), costCenterId: ccByKey("manutencao"),
            paymentMethod: "Pix", status: "pendente", reconciled: false });
        }
      }

      // Impostos (% sobre receita do mês anterior, aproximando Simples Nacional)
      if (mIdx > 0) {
        var prevMk = months[mIdx - 1];
        var prevRevenue = monthRevenue(prevMk);
        if (prevRevenue > 0) {
          var taxDate = mdate(15);
          transactions.push({ id: DB.uid("txn"), date: taxDate, type: "despesa", description: "Impostos (Simples Nacional) ref. " + Utils.monthLabel(prevMk + "-01"),
            amount: round2(prevRevenue * randFloat(0.06, 0.08)), categoryId: catByName("Impostos e Taxas"), costCenterId: ccByKey("administrativo"),
            paymentMethod: "Boleto", status: statusFor(taxDate), reconciled: false, relatedMonth: prevMk });
        }
      }

      // Comissões (pagas no mês seguinte com base na receita do mês anterior)
      if (mIdx > 0) {
        var payMk = months[mIdx - 1];
        var comDate = mdate(10);
        employees.filter(function (e) { return e.commissionRate > 0; }).forEach(function (e) {
          var rev = employeeMonthServiceRevenue(e.id, payMk);
          if (rev <= 0) return;
          var commissionAmt = round2(rev * (e.commissionRate / 100));
          transactions.push({ id: DB.uid("txn"), date: comDate, type: "despesa",
            description: "Comissão - " + e.name + " (ref. " + Utils.monthLabel(payMk + "-01") + ")",
            amount: commissionAmt, categoryId: catByName("Comissões"), costCenterId: ccByKey("rh"),
            paymentMethod: "Transferência", status: statusFor(comDate), employeeId: e.id,
            reconciled: false, relatedMonth: payMk });
        });
      }
    });

    // ---- Contas a Pagar: exemplos extras de vencidas e programadas, para a
    // tela de Contas a Pagar não ficar vazia (fora do laço de meses, pois
    // representam contas em atraso ou já lançadas com vencimento futuro) ----
    var overdue1 = Utils.addDays(today, -randInt(3, 9));
    transactions.push({ id: DB.uid("txn"), date: overdue1, type: "despesa", description: "Fornecedor de produtos capilares - fatura em atraso",
      amount: round2(randFloat(320, 780)), categoryId: catByName("Produtos e Insumos"), costCenterId: ccByKey("operacional"),
      paymentMethod: "Boleto", status: "pendente", reconciled: false });
    var overdue2 = Utils.addDays(today, -randInt(1, 5));
    transactions.push({ id: DB.uid("txn"), date: overdue2, type: "despesa", description: "Mensalidade de sistema de gestão - fatura em atraso",
      amount: 179, categoryId: catByName("Software e Assinaturas"), costCenterId: ccByKey("administrativo"),
      paymentMethod: "Cartão de Crédito", status: "pendente", reconciled: false });

    var sched1 = Utils.addDays(today, randInt(10, 20));
    transactions.push({ id: DB.uid("txn"), date: sched1, type: "despesa", description: "Aluguel do salão - próximo mês (programado)",
      amount: round2(4200 * (1 + months.length * 0.006)), categoryId: catByName("Aluguel"), costCenterId: ccByKey("administrativo"),
      paymentMethod: "Transferência", status: "pendente", reconciled: false });
    var sched2 = Utils.addDays(today, randInt(15, 30));
    transactions.push({ id: DB.uid("txn"), date: sched2, type: "despesa", description: "Renovação de contrato - fornecedor de produtos",
      amount: round2(randFloat(600, 1400)), categoryId: catByName("Produtos e Insumos"), costCenterId: ccByKey("operacional"),
      paymentMethod: "Boleto", status: "pendente", reconciled: false });
    var sched3 = Utils.addDays(today, randInt(25, 45));
    transactions.push({ id: DB.uid("txn"), date: sched3, type: "despesa", description: "Manutenção anual de equipamentos (agendada)",
      amount: round2(randFloat(500, 1100)), categoryId: catByName("Manutenção e Reparos"), costCenterId: ccByKey("manutencao"),
      paymentMethod: "Pix", status: "pendente", reconciled: false });

    // ---- Bonificações de comissão: exemplos de prêmio fixo e de percentual
    // extra sobre uma venda, para a tela de Comissionamento (e o extrato do
    // profissional) já demonstrarem o recurso com dados de exemplo ----
    var commissionBonuses = [];
    var bonusCandidates = employees.filter(function (e) { return e.commissionRate > 0; });
    if (bonusCandidates.length) {
      var currentMonthKey = Utils.monthKey(today);
      var b1 = bonusCandidates[0];
      commissionBonuses.push({ id: DB.uid("bon"), employeeId: b1.id, month: currentMonthKey, kind: "fixo",
        description: "Bônus por meta de atendimentos batida em " + Utils.monthLabel(currentMonthKey + "-01"),
        amount: 150, refValue: null, refPercent: null, createdAt: DB.nowISO(), updatedAt: DB.nowISO() });
      if (bonusCandidates.length > 1) {
        var b2 = bonusCandidates[1];
        var refValue = round2(randFloat(180, 320));
        var refPercent = 10;
        commissionBonuses.push({ id: DB.uid("bon"), employeeId: b2.id, month: currentMonthKey, kind: "percentual",
          description: "Comissão extra na venda de um kit de produtos",
          amount: round2(refValue * (refPercent / 100)), refValue: refValue, refPercent: refPercent,
          createdAt: DB.nowISO(), updatedAt: DB.nowISO() });
      }
    }

    // ---- Venda com múltiplos itens: exemplo de um cliente que fez mais de
    // um serviço (e comprou um produto) na mesma visita, lançados juntos
    // com o mesmo saleId — para a tela de Lançamentos já demonstrar o
    // recurso "Nova Venda (múltiplos itens)" com um caso real ----
    if (clients.length && employees.length) {
      var saleDate = Utils.addDays(today, -randInt(1, 6));
      var saleClient = pick(clients);
      var hairPro = pick(employees.filter(function (e) { return e.role === "Cabeleireiro(a)"; })) || pick(employees);
      var nailPro = pick(employees.filter(function (e) { return e.role === "Manicure e Pedicure"; })) || pick(employees);
      var saleId = DB.uid("venda");
      [
        { desc: "Corte + Escova - " + saleClient.name, cat: "Serviços - Cabelo", emp: hairPro, amount: round2(randFloat(90, 160)) },
        { desc: "Manicure e Pedicure - " + saleClient.name, cat: "Serviços - Unhas", emp: nailPro, amount: round2(randFloat(50, 90)) },
        { desc: "Água de coco", cat: "Venda de Produtos", emp: null, amount: round2(randFloat(6, 12)) }
      ].forEach(function (item, idx) {
        transactions.push({
          id: DB.uid("txn"), type: "receita", description: item.desc, amount: item.amount, date: saleDate,
          categoryId: catByName(item.cat), costCenterId: item.cat === "Venda de Produtos" ? ccByKey("comercial") : ccByKey("operacional"),
          paymentMethod: "Pix", status: "pago", clientId: saleClient.id, employeeId: item.emp ? item.emp.id : null,
          reconciled: false, saleId: saleId, saleItemIndex: idx
        });
      });
    }

    // ---- 5) Conciliação: histórico com +45 dias já concilia­do ----
    var cutoff = Utils.addDays(today, -45);
    var bankLines = [];
    transactions.forEach(function (t) {
      if (t.status !== "pago") return;
      if (t.paymentMethod === "Dinheiro") return; // dinheiro não passa por extrato
      if (t.date > cutoff) return; // fica em aberto p/ o usuário conciliar
      var bankDate = Utils.addDays(t.date, randInt(0, 2));
      var desc = t.type === "receita"
        ? (t.paymentMethod === "Pix" ? "PIX RECEBIDO - " : t.paymentMethod.indexOf("Cartão") > -1 ? "REC CARTAO - " : "TED RECEBIDA - ") + t.description.toUpperCase()
        : (t.paymentMethod === "Transferência" ? "TED ENVIADA - " : t.paymentMethod === "Boleto" ? "PGTO BOLETO - " : "PIX ENVIADO - ") + t.description.toUpperCase();
      var line = {
        id: DB.uid("bnk"), date: bankDate, description: desc.slice(0, 90),
        amount: t.type === "receita" ? t.amount : -t.amount,
        matched: true, matchedTransactionId: t.id, importedAt: DB.nowISO(), source: "seed"
      };
      bankLines.push(line);
      t.reconciled = true;
      t.bankLineId = line.id;
    });

    // ---- Persistência ----
    DB.setTable("costCenters", costCenters);
    DB.setTable("categories", categories);
    DB.setTable("services", services);
    DB.setTable("employees", employees);
    DB.setTable("clients", clients);
    DB.setTable("products", products);
    DB.setTable("appointments", appointments);
    DB.setTable("transactions", transactions);
    DB.setTable("stockMovements", stockMovements);
    DB.setTable("bankLines", bankLines);
    DB.setTable("commissionPayouts", []);
    DB.setTable("commissionBonuses", commissionBonuses);
    DB.updateSettings({ companyName: "Guitart & Co.", seededAt: DB.nowISO(), dataFrom: startDate, dataTo: today });
  }

  global.Seed = { run: run };
})(window);
