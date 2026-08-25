/* ============================================================
   Salão ERP — Cadastro rápido de cliente + importação de contato
   Módulo compartilhado: usado pela Agenda (botão "Criar novo
   cliente" dentro do modal de agendamento) e por Clientes (opção
   "Importar contato" no cadastro completo). A importação usa a
   Contact Picker API do navegador (navigator.contacts.select),
   suportada hoje principalmente no Chrome Android — por isso o
   botão só aparece quando a API existe (feature-detection), sem
   quebrar o fluxo em desktop/navegadores sem suporte.
   ============================================================ */
(function (global) {
  "use strict";

  function contactPickerSupported() {
    return !!(navigator.contacts && typeof navigator.contacts.select === "function");
  }

  // Abre o seletor de contatos do aparelho e preenche nome/telefone nos
  // inputs informados. Precisa rodar a partir de um clique do usuário
  // (gesto direto), exigido pela própria API.
  function importContact(nameInput, phoneInput) {
    if (!contactPickerSupported()) return;
    var props = ["name", "tel"];
    navigator.contacts.select(props, { multiple: false }).then(function (contacts) {
      if (!contacts || !contacts.length) return;
      var c = contacts[0];
      if (c.name && c.name.length && nameInput) nameInput.value = c.name[0];
      if (c.tel && c.tel.length && phoneInput) phoneInput.value = c.tel[0];
      if (global.Toast) Toast.show("Contato importado da agenda do celular", "success");
    }).catch(function () {
      // usuário cancelou o seletor, ou o navegador negou — não é um erro real do sistema
    });
  }

  function importButtonHtml(id) {
    if (!contactPickerSupported()) return "";
    return '<button type="button" class="btn btn-sm btn-outline" id="' + id + '"><i class="fa-solid fa-address-book"></i> Importar contato</button>';
  }

  function wireImportButton(box, btnId, nameInput, phoneInput) {
    var btn = box.querySelector("#" + btnId);
    if (btn) btn.addEventListener("click", function () { importContact(nameInput, phoneInput); });
  }

  // HTML de um painel inline de "cadastro rápido de cliente" (nome +
  // telefone + e-mail + importar contato). Pensado para ser inserido DENTRO
  // de um modal já aberto (ex.: o modal de agendamento), em vez de abrir um
  // segundo modal empilhado — este app só suporta um modal ativo por vez.
  // `idPrefix` evita colisão de ids quando há mais de um painel na página.
  function inlinePanelHtml(idPrefix) {
    return '<div class="form-grid">' +
      '<div class="form-field full"><label>Nome Completo</label><input type="text" id="' + idPrefix + '-name" value=""></div>' +
      '<div class="form-field"><label>Telefone (com DDD)</label><input type="tel" id="' + idPrefix + '-phone" placeholder="(11) 98765-4321" value=""></div>' +
      '<div class="form-field"><label>E-mail</label><input type="email" id="' + idPrefix + '-email" value=""></div>' +
      '</div>' +
      '<div class="flex gap-8 items-center mt-8">' +
        importButtonHtml(idPrefix + "-import-contact") +
        '<button type="button" class="btn btn-sm btn-primary" id="' + idPrefix + '-save">Salvar Cliente</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" id="' + idPrefix + '-cancel">Cancelar</button>' +
      '</div>';
  }

  // Liga os botões do painel inline. onCreated(client) é chamado ao salvar;
  // onCancel() ao cancelar. `container` é o elemento (dentro do `box` do
  // modal pai) onde o HTML de inlinePanelHtml(idPrefix) foi inserido.
  function wireInlinePanel(container, idPrefix, onCreated, onCancel) {
    var nameInput = container.querySelector("#" + idPrefix + "-name");
    var phoneInput = container.querySelector("#" + idPrefix + "-phone");
    wireImportButton(container, idPrefix + "-import-contact", nameInput, phoneInput);
    container.querySelector("#" + idPrefix + "-save").addEventListener("click", function () {
      var name = nameInput.value.trim();
      if (!name) { Toast.show("Informe o nome do cliente", "danger"); return; }
      var phone = phoneInput.value.trim();
      if (!phone) { Toast.show("Informe o telefone do cliente, com DDD", "danger"); return; }
      if (!Utils.isValidPhoneBR(phone)) { Toast.show("Telefone inválido — informe com DDD (ex.: (11) 98765-4321)", "danger"); return; }
      var patch = {
        name: name, phone: phone, email: container.querySelector("#" + idPrefix + "-email").value.trim(),
        birthday: null, firstVisit: Utils.todayISO(), tags: [], notes: ""
      };
      var client = DB.insert("clients", patch);
      DB.log("Cliente", "Cadastrou o cliente " + name + " (cadastro rápido)");
      Toast.show("Cliente cadastrado", "success");
      if (typeof onCreated === "function") onCreated(client);
    });
    var cancelBtn = container.querySelector("#" + idPrefix + "-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { if (typeof onCancel === "function") onCancel(); });
  }

  global.ClientesQuick = {
    contactPickerSupported: contactPickerSupported,
    importContact: importContact,
    importButtonHtml: importButtonHtml,
    wireImportButton: wireImportButton,
    inlinePanelHtml: inlinePanelHtml,
    wireInlinePanel: wireInlinePanel
  };
})(window);
