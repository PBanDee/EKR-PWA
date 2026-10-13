const DATABASE_NAME = 'ekr-local-data';
const DATABASE_VERSION = 1;
const INSTALLATIONS_STORE = 'installations';
const AUTOSAVE_DELAY = 450;
const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_INSTALLATION_PHOTO_BYTES = 50 * 1024 * 1024;
const PHOTO_CATEGORIES = [
  { value: 'site', label: 'Helyszín' },
  { value: 'before', label: 'Munka előtt' },
  { value: 'during', label: 'Munka közben' },
  { value: 'after', label: 'Munka után' },
  { value: 'other', label: 'Egyéb' }
];

const appBaseUrl = new URL('./', window.location.href);
const homeScreen = document.querySelector('#home-screen');
const editorScreen = document.querySelector('#editor-screen');
const installationList = document.querySelector('#installation-list');
const installationSummary = document.querySelector('#installation-summary');
const installationForm = document.querySelector('#installation-form');
const documentsContainer = document.querySelector('#documents-container');
const photoInput = document.querySelector('#photo-input');
const photosContainer = document.querySelector('#photos-container');
const photoSummary = document.querySelector('#photo-summary');
const signaturesContainer = document.querySelector('#signatures-container');
const signatureSummary = document.querySelector('#signature-summary');
const signatureCanvas = document.querySelector('#signature-canvas');
const signatureContext = signatureCanvas.getContext('2d');
const signerNameInput = document.querySelector('#signer-name');
const signerRoleInput = document.querySelector('#signer-role');
const signatureFeedback = document.querySelector('#signature-feedback');
const acceptSignatureButton = document.querySelector('#accept-signature');
const clearSignatureButton = document.querySelector('#clear-signature');
const saveState = document.querySelector('#save-state');
const notice = document.querySelector('#notice');
const finalizeButton = document.querySelector('#finalize-installation');

let database;
let configuration;
let currentInstallation;
let photoObjectUrls = [];
let signatureObjectUrls = [];
let signatureHasInk = false;
let activeSignaturePointerId = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
let editRevision = 0;
let hasUnsavedChanges = false;
let lastSaveError = null;

function createId() {
  if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
    throw new Error('Ezen az eszközön nem érhető el biztonságos UUID-generálás.');
  }
  return window.crypto.randomUUID();
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('is-error', isError);
  notice.hidden = false;
}

function clearNotice() {
  notice.textContent = '';
  notice.classList.remove('is-error');
  notice.hidden = true;
}

function setSaveState(message, state = 'saved') {
  saveState.textContent = message;
  saveState.classList.toggle('is-saving', state === 'saving');
  saveState.classList.toggle('is-error', state === 'error');
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('Az adatbázis-művelet megszakadt.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('Az adatbázis-művelet nem sikerült.')), { once: true });
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INSTALLATIONS_STORE)) {
        const store = db.createObjectStore(INSTALLATIONS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Az adatbázis frissítése blokkolva van egy másik megnyitott lapon.')), { once: true });
  });
}

async function getAllInstallations() {
  const transaction = database.transaction(INSTALLATIONS_STORE, 'readonly');
  const done = transactionDone(transaction);
  const request = transaction.objectStore(INSTALLATIONS_STORE).getAll();
  const records = await requestResult(request);
  await done;
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function putInstallation(installation) {
  const transaction = database.transaction(INSTALLATIONS_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(INSTALLATIONS_STORE).put(installation);
  await done;
}

async function getInstallation(id) {
  const transaction = database.transaction(INSTALLATIONS_STORE, 'readonly');
  const done = transactionDone(transaction);
  const installation = await requestResult(transaction.objectStore(INSTALLATIONS_STORE).get(id));
  await done;
  return installation;
}

async function loadConfiguration() {
  const response = await fetch(new URL('./templates.json', appBaseUrl));
  if (!response.ok) {
    throw new Error(`A dokumentumsablonok betöltése sikertelen (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!data.contractorId || !data.configVersion || !Array.isArray(data.documentTemplates)) {
    throw new Error('A dokumentumsablonok konfigurációja hiányos vagy hibás.');
  }
  return data;
}

function localDateString() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function fieldValueIsPresent(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function createDocument(template, installationId) {
  const values = {};
  for (const field of template.fields) {
    if (field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue;
    } else if (field.type === 'multichoice') {
      values[field.id] = [];
    } else if (field.type === 'boolean') {
      values[field.id] = false;
    } else {
      values[field.id] = '';
    }
  }
  return {
    id: createId(),
    installationId,
    templateCode: template.code,
    templateVersion: template.version,
    completed: false,
    values
  };
}

function createInstallation() {
  const id = createId();
  const now = new Date().toISOString();
  return {
    id,
    contractorId: configuration.contractorId,
    configVersion: configuration.configVersion,
    templateSnapshots: structuredClone(configuration.documentTemplates),
    customerName: '',
    siteAddress: '',
    installationDate: localDateString(),
    syncStatus: 'draft',
    createdAt: now,
    updatedAt: now,
    documents: configuration.documentTemplates.map((template) => createDocument(template, id)),
    photos: [],
    signatures: []
  };
}

function addFieldHelp(container, helpText) {
  if (!helpText) return;
  const help = document.createElement('small');
  help.className = 'field-help';
  help.textContent = helpText;
  container.append(help);
}

function createField(template, field, value) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const label = document.createElement('span');
  label.textContent = field.label;
  if (field.required) {
    const required = document.createElement('span');
    required.className = 'required-mark';
    required.textContent = ' *';
    label.append(required);
  }
  wrapper.append(label);

  if (field.type === 'boolean') {
    wrapper.classList.add('field-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.dataset.documentCode = template.code;
    input.dataset.fieldId = field.id;
    input.dataset.fieldType = field.type;
    wrapper.append(input);
    label.textContent = field.label;
    if (field.required) label.textContent += ' *';
    addFieldHelp(wrapper, field.helpText);
    return wrapper;
  }

  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
  } else if (field.type === 'choice') {
    input = document.createElement('select');
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Válassz…';
    input.append(emptyOption);
    for (const option of field.options || []) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      input.append(element);
    }
  } else if (field.type === 'multichoice') {
    const choices = document.createElement('div');
    choices.className = 'choice-list';
    for (const option of field.options || []) {
      const choice = document.createElement('label');
      choice.className = 'field-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Array.isArray(value) && value.includes(option.value);
      checkbox.value = option.value;
      checkbox.dataset.documentCode = template.code;
      checkbox.dataset.fieldId = field.id;
      checkbox.dataset.fieldType = field.type;
      const choiceText = document.createElement('span');
      choiceText.textContent = option.label;
      choice.append(checkbox, choiceText);
      choices.append(choice);
    }
    wrapper.append(choices);
    addFieldHelp(wrapper, field.helpText);
    return wrapper;
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' || field.type === 'date' || field.type === 'time' ? field.type : 'text';
  }

  input.value = value === undefined || value === null ? '' : String(value);
  input.dataset.documentCode = template.code;
  input.dataset.fieldId = field.id;
  input.dataset.fieldType = field.type;
  if (field.required) input.required = true;
  if (field.validation && field.type === 'text') {
    if (field.validation.minLength !== undefined) input.minLength = field.validation.minLength;
    if (field.validation.maxLength !== undefined) input.maxLength = field.validation.maxLength;
    if (field.validation.pattern) input.pattern = field.validation.pattern;
  }
  if (field.validation && field.type === 'number') {
    if (field.validation.min !== undefined) input.min = String(field.validation.min);
    if (field.validation.max !== undefined) input.max = String(field.validation.max);
  }
  wrapper.append(input);
  addFieldHelp(wrapper, field.helpText);
  return wrapper;
}

function renderDocuments() {
  documentsContainer.replaceChildren();
  for (const [index, template] of currentInstallation.templateSnapshots.entries()) {
    const documentRecord = currentInstallation.documents.find((item) => item.templateCode === template.code);
    if (!documentRecord) {
      throw new Error(`Hiányzik a(z) „${template.title}” dokumentum helyi adata.`);
    }
    const card = document.createElement('section');
    card.className = 'form-card';
    const heading = document.createElement('div');
    heading.className = 'card-heading';
    const step = document.createElement('span');
    step.className = 'step-number';
    step.textContent = String(index + 2).padStart(2, '0');
    const titleBlock = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = template.title;
    const description = document.createElement('p');
    description.textContent = template.required ? 'Kötelező dokumentum' : 'Opcionális dokumentum';
    titleBlock.append(title, description);
    heading.append(step, titleBlock);
    card.append(heading);

    const fields = document.createElement('div');
    fields.className = 'field-grid';
    for (const field of template.fields) {
      fields.append(createField(template, field, documentRecord.values[field.id]));
    }
    card.append(fields);
    documentsContainer.append(card);
  }
}

function showEditor(installation) {
  clearPhotoObjectUrls();
  clearSignatureObjectUrls();
  clearSignatureCanvas();
  currentInstallation = installation;
  editRevision = 0;
  hasUnsavedChanges = false;
  lastSaveError = null;
  clearNotice();
  homeScreen.hidden = true;
  editorScreen.hidden = false;
  document.querySelector('#editor-title').textContent = installation.customerName || 'Új kivitelezés';
  document.querySelector('#editor-description').textContent = installation.syncStatus === 'draft'
    ? 'A módosítások automatikusan, helyben mentődnek.'
    : 'Ez a munka véglegesítve van. A helyi adatok megmaradnak ezen az eszközön.';

  installationForm.elements.customerName.value = installation.customerName;
  installationForm.elements.siteAddress.value = installation.siteAddress;
  installationForm.elements.installationDate.value = installation.installationDate;
  document.querySelector('#photos-step').textContent = String(installation.templateSnapshots.length + 2).padStart(2, '0');
  document.querySelector('#signatures-step').textContent = String(installation.templateSnapshots.length + 3).padStart(2, '0');
  renderDocuments();

  const isEditable = installation.syncStatus === 'draft';
  for (const element of installationForm.elements) {
    element.disabled = !isEditable;
  }
  for (const element of documentsContainer.querySelectorAll('input, textarea, select')) {
    element.disabled = !isEditable;
  }
  photoInput.disabled = !isEditable;
  signerNameInput.disabled = !isEditable;
  signerRoleInput.disabled = !isEditable;
  signatureCanvas.classList.toggle('is-disabled', !isEditable);
  signatureCanvas.setAttribute('aria-disabled', String(!isEditable));
  acceptSignatureButton.disabled = !isEditable;
  clearSignatureButton.disabled = !isEditable;
  finalizeButton.hidden = !isEditable;
  renderPhotos();
  renderSignatures();
  updateSignatureFeedback();
  if (isEditable) {
    setSaveState('Helyben mentve');
  } else {
    setSaveState('Véglegesítve · feltöltésre vár');
  }
}

function readFormIntoInstallation() {
  currentInstallation.customerName = installationForm.elements.customerName.value.trim();
  currentInstallation.siteAddress = installationForm.elements.siteAddress.value.trim();
  currentInstallation.installationDate = installationForm.elements.installationDate.value;

  const documentsByCode = new Map(currentInstallation.documents.map((item) => [item.templateCode, item]));
  const multichoiceValues = new Map();
  for (const input of documentsContainer.querySelectorAll('[data-field-id]')) {
    const documentRecord = documentsByCode.get(input.dataset.documentCode);
    if (!documentRecord) continue;
    const { fieldId, fieldType } = input.dataset;
    if (fieldType === 'multichoice') {
      if (!multichoiceValues.has(`${input.dataset.documentCode}:${fieldId}`)) {
        multichoiceValues.set(`${input.dataset.documentCode}:${fieldId}`, []);
      }
      if (input.checked) multichoiceValues.get(`${input.dataset.documentCode}:${fieldId}`).push(input.value);
      continue;
    }
    if (fieldType === 'boolean') {
      documentRecord.values[fieldId] = input.checked;
    } else if (fieldType === 'number') {
      documentRecord.values[fieldId] = input.value === '' ? '' : Number(input.value);
    } else {
      documentRecord.values[fieldId] = input.value;
    }
  }
  for (const [key, values] of multichoiceValues) {
    const [documentCode, fieldId] = key.split(':');
    documentsByCode.get(documentCode).values[fieldId] = values;
  }
  currentInstallation.updatedAt = new Date().toISOString();
}

async function persistCurrentInstallation() {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft' || !hasUnsavedChanges) return;
  const revisionAtStart = editRevision;
  readFormIntoInstallation();
  await putInstallation(currentInstallation);
  lastSaveError = null;
  if (editRevision === revisionAtStart) {
    hasUnsavedChanges = false;
    setSaveState('Helyben mentve');
  }
  await renderInstallationList();
}

function enqueueSave() {
  saveQueue = saveQueue
    .then(persistCurrentInstallation)
    .catch((error) => {
      lastSaveError = error;
      console.error('A helyi automatikus mentés nem sikerült.', error);
      setSaveState('A helyi mentés nem sikerült', 'error');
      showNotice('Nem sikerült helyben menteni. Ellenőrizd az eszköz szabad tárhelyét, majd próbáld újra.', true);
    });
}

function scheduleSave() {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return;
  editRevision += 1;
  hasUnsavedChanges = true;
  lastSaveError = null;
  setSaveState('Mentés…', 'saving');
  clearNotice();
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    enqueueSave();
  }, AUTOSAVE_DELAY);
}

function persistChangesNow() {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return Promise.resolve();
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  editRevision += 1;
  hasUnsavedChanges = true;
  lastSaveError = null;
  setSaveState('Mentés…', 'saving');
  enqueueSave();
  return saveQueue.then(() => {
    if (lastSaveError) throw lastSaveError;
  });
}

async function flushPendingSave() {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (hasUnsavedChanges) enqueueSave();
  await saveQueue;
  if (lastSaveError) throw lastSaveError;
}

function statusLabel(status) {
  if (status === 'pending_upload') return { text: 'Feltöltésre vár', className: 'pending' };
  if (status === 'upload_error') return { text: 'Feltöltési hiba', className: 'error' };
  if (status === 'uploading') return { text: 'Feltöltés folyamatban', className: 'pending' };
  if (status === 'uploaded') return { text: 'Feltöltve', className: '' };
  return { text: 'Piszkozat · helyben mentve', className: '' };
}

function formatDate(value) {
  if (!value) return 'Nincs dátum';
  const [year, month, day] = value.split('-');
  return `${year}. ${month}. ${day}.`;
}

async function renderInstallationList() {
  const installations = await getAllInstallations();
  installationList.replaceChildren();
  installationSummary.textContent = installations.length === 1
    ? '1 helyben tárolt munka'
    : `${installations.length} helyben tárolt munka`;
  const pending = installations.filter((item) => ['pending_upload', 'uploading', 'upload_error'].includes(item.syncStatus)).length;
  document.querySelector('#pending-count').textContent = `Feltöltésre váró munkák: ${pending}`;
  document.querySelector('#sync-hint').textContent = pending > 0
    ? 'A központi feltöltés ebben a prototípusban még nem érhető el'
    : 'Központi szinkronizáció még nem érhető el';

  if (installations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';
    const title = document.createElement('h3');
    title.textContent = 'Még nincs rögzített kivitelezés';
    const description = document.createElement('p');
    description.textContent = 'Hozz létre egy új munkát. A piszkozat és az űrlap módosításai automatikusan ezen az eszközön maradnak.';
    empty.append(icon, title, description);
    installationList.append(empty);
    return;
  }

  for (const installation of installations) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'installation-card';
    const details = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'installation-name';
    name.textContent = installation.customerName || 'Új kivitelezés';
    const address = document.createElement('span');
    address.className = 'installation-address';
    address.textContent = installation.siteAddress || 'A helyszín címe még nincs megadva';
    details.append(name, address);
    const meta = document.createElement('span');
    meta.className = 'installation-meta';
    const date = document.createElement('span');
    date.textContent = formatDate(installation.installationDate);
    const badge = document.createElement('span');
    const status = statusLabel(installation.syncStatus);
    badge.className = `state-badge ${status.className}`.trim();
    badge.textContent = status.text;
    meta.append(date, badge);
    card.append(details, meta);
    card.addEventListener('click', async () => {
      try {
        await openInstallation(installation.id);
      } catch (error) {
        reportError('A kivitelezés megnyitása nem sikerült.', error);
      }
    });
    installationList.append(card);
  }
}

async function openInstallation(id) {
  const installation = await getInstallation(id);
  if (!installation) throw new Error('A kiválasztott kivitelezés nem található a helyi adatbázisban.');
  showEditor(installation);
}

async function returnHome() {
  await flushPendingSave();
  clearPhotoObjectUrls();
  clearSignatureObjectUrls();
  currentInstallation = null;
  editorScreen.hidden = true;
  homeScreen.hidden = false;
  clearNotice();
  await renderInstallationList();
}

function findMissingRequiredValues() {
  const missing = [];
  if (!currentInstallation.customerName) missing.push('Ügyfél neve');
  if (!currentInstallation.siteAddress) missing.push('Helyszín címe');
  if (!currentInstallation.installationDate) missing.push('Kivitelezés dátuma');

  for (const template of currentInstallation.templateSnapshots) {
    if (!template.required) continue;
    const record = currentInstallation.documents.find((item) => item.templateCode === template.code);
    for (const field of template.fields.filter((item) => item.required)) {
      if (!fieldValueIsPresent(record && record.values[field.id])) {
        missing.push(`${template.title}: ${field.label}`);
      }
    }
  }
  return missing;
}

function clearPhotoObjectUrls() {
  for (const objectUrl of photoObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }
  photoObjectUrls = [];
}

function clearSignatureObjectUrls() {
  for (const objectUrl of signatureObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }
  signatureObjectUrls = [];
}

function updateSignatureFeedback(message) {
  if (message) {
    signatureFeedback.textContent = message;
    return;
  }
  signatureFeedback.textContent = signatureHasInk
    ? 'Aláírás rögzítve. Elfogadás után helyben mentjük.'
    : 'Rajzolj aláírást a fenti mezőbe.';
}

function clearSignatureCanvas() {
  signatureContext.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureHasInk = false;
  activeSignaturePointerId = null;
  updateSignatureFeedback();
}

function signaturePoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * signatureCanvas.width / rect.width,
    y: (event.clientY - rect.top) * signatureCanvas.height / rect.height
  };
}

function beginSignatureStroke(event) {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft' || activeSignaturePointerId !== null) return;
  event.preventDefault();
  activeSignaturePointerId = event.pointerId;
  signatureCanvas.setPointerCapture(event.pointerId);
  const point = signaturePoint(event);
  signatureContext.beginPath();
  signatureContext.moveTo(point.x, point.y);
  signatureContext.lineTo(point.x + 0.1, point.y + 0.1);
  signatureContext.lineWidth = 6;
  signatureContext.lineCap = 'round';
  signatureContext.lineJoin = 'round';
  signatureContext.strokeStyle = '#19332f';
  signatureContext.stroke();
  signatureHasInk = true;
  updateSignatureFeedback();
}

function continueSignatureStroke(event) {
  if (event.pointerId !== activeSignaturePointerId) return;
  event.preventDefault();
  const point = signaturePoint(event);
  signatureContext.lineTo(point.x, point.y);
  signatureContext.stroke();
}

function endSignatureStroke(event) {
  if (event.pointerId !== activeSignaturePointerId) return;
  if (signatureCanvas.hasPointerCapture(event.pointerId)) {
    signatureCanvas.releasePointerCapture(event.pointerId);
  }
  activeSignaturePointerId = null;
  signatureContext.closePath();
}

function formatSignatureDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ismeretlen időpont';
  return new Intl.DateTimeFormat('hu-HU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function renderSignatures() {
  clearSignatureObjectUrls();
  signaturesContainer.replaceChildren();
  const signatures = currentInstallation.signatures || [];
  signatureSummary.textContent = signatures.length
    ? `${signatures.length} aláírás helyben mentve`
    : 'Még nincs aláírás csatolva.';

  for (const signature of signatures) {
    const card = document.createElement('article');
    card.className = 'signature-card';
    const details = document.createElement('div');
    details.className = 'signature-card-details';
    const name = document.createElement('strong');
    name.textContent = signature.signerName;
    const role = document.createElement('span');
    role.textContent = signature.signerRole || 'Szerepkör nincs megadva';
    const date = document.createElement('small');
    date.textContent = `Aláírva: ${formatSignatureDate(signature.signedAt)}`;
    details.append(name, role, date);

    const image = document.createElement('img');
    image.className = 'signature-preview';
    image.alt = `Rajzolt aláírás: ${signature.signerName}`;
    image.src = URL.createObjectURL(signature.imageBlob);
    signatureObjectUrls.push(image.src);

    const removeButton = document.createElement('button');
    removeButton.className = 'button photo-remove signature-remove';
    removeButton.type = 'button';
    removeButton.textContent = 'Aláírás törlése';
    removeButton.dataset.removeSignatureId = signature.id;
    removeButton.disabled = currentInstallation.syncStatus !== 'draft';
    card.append(details, image, removeButton);
    signaturesContainer.append(card);
  }
}

async function acceptSignature() {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return;
  if (!signerNameInput.value.trim()) {
    signerNameInput.setCustomValidity('Add meg az aláíró nevét.');
    signerNameInput.reportValidity();
    signerNameInput.addEventListener('input', () => signerNameInput.setCustomValidity(''), { once: true });
    return;
  }
  if (!signatureHasInk) {
    updateSignatureFeedback('Az aláírás üres. Rajzolj aláírást a mentés előtt.');
    signatureCanvas.focus();
    return;
  }

  acceptSignatureButton.disabled = true;
  try {
    const imageBlob = await new Promise((resolve, reject) => {
      signatureCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Az aláírás képpé alakítása nem sikerült.'));
      }, 'image/png');
    });
    const signature = {
      id: createId(),
      installationId: currentInstallation.id,
      signerName: signerNameInput.value.trim(),
      signerRole: signerRoleInput.value.trim(),
      imageBlob,
      signedAt: new Date().toISOString()
    };
    const previousSignatures = currentInstallation.signatures || [];
    currentInstallation.signatures = [...previousSignatures, signature];
    renderSignatures();
    try {
      await persistChangesNow();
    } catch (error) {
      currentInstallation.signatures = previousSignatures;
      renderSignatures();
      throw error;
    }
    clearSignatureCanvas();
    signerNameInput.value = '';
    signerRoleInput.value = '';
    showNotice('Az aláírás helyben mentve. Ez nem tanúsítványalapú digitális aláírás.');
  } catch (error) {
    reportError('Az aláírás helyi mentése nem sikerült.', error);
  } finally {
    acceptSignatureButton.disabled = currentInstallation.syncStatus !== 'draft';
  }
}

async function removeSignature(signatureId) {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return;
  const previousSignatures = currentInstallation.signatures;
  currentInstallation.signatures = previousSignatures.filter((signature) => signature.id !== signatureId);
  renderSignatures();
  try {
    await persistChangesNow();
    showNotice('Az aláírás törölve a helyi kivitelezésből.');
  } catch (error) {
    currentInstallation.signatures = previousSignatures;
    renderSignatures();
    reportError('Az aláírás törlését nem sikerült helyben menteni.', error);
  }
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPhotos() {
  clearPhotoObjectUrls();
  photosContainer.replaceChildren();
  const photos = currentInstallation.photos || [];
  const totalBytes = photos.reduce((total, photo) => total + (photo.blob instanceof Blob ? photo.blob.size : 0), 0);
  photoSummary.textContent = photos.length
    ? `${photos.length} fénykép · ${formatFileSize(totalBytes)} helyi tárhely`
    : 'Még nincs fénykép csatolva.';

  for (const photo of photos) {
    const card = document.createElement('article');
    card.className = 'photo-card';
    const preview = document.createElement('div');
    preview.className = 'photo-preview';
    const image = document.createElement('img');
    image.alt = photo.caption || photo.fileName;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.hidden = true;
      preview.classList.add('photo-preview-unavailable');
      const unavailable = document.createElement('span');
      unavailable.className = 'photo-unavailable';
      unavailable.textContent = 'Az előnézet nem támogatott ebben a böngészőben. Az eredeti kép helyben mentve marad.';
      preview.append(unavailable);
    }, { once: true });
    const objectUrl = URL.createObjectURL(photo.blob);
    photoObjectUrls.push(objectUrl);
    image.src = objectUrl;
    preview.append(image);

    const details = document.createElement('div');
    details.className = 'photo-details';
    const fileName = document.createElement('span');
    fileName.className = 'photo-filename';
    fileName.textContent = photo.fileName;
    const fileSize = document.createElement('small');
    fileSize.textContent = formatFileSize(photo.blob.size);
    details.append(fileName, fileSize);

    const categoryLabel = document.createElement('label');
    categoryLabel.className = 'field photo-field';
    const categoryTitle = document.createElement('span');
    categoryTitle.textContent = 'Kategória';
    const categoryInput = document.createElement('select');
    categoryInput.dataset.photoId = photo.id;
    categoryInput.dataset.photoProperty = 'category';
    for (const category of PHOTO_CATEGORIES) {
      const option = document.createElement('option');
      option.value = category.value;
      option.textContent = category.label;
      categoryInput.append(option);
    }
    categoryInput.value = PHOTO_CATEGORIES.some((category) => category.value === photo.category)
      ? photo.category
      : 'site';
    categoryInput.disabled = currentInstallation.syncStatus !== 'draft';
    categoryLabel.append(categoryTitle, categoryInput);

    const captionLabel = document.createElement('label');
    captionLabel.className = 'field photo-field';
    const captionTitle = document.createElement('span');
    captionTitle.textContent = 'Megjegyzés';
    const captionInput = document.createElement('input');
    captionInput.type = 'text';
    captionInput.maxLength = 160;
    captionInput.placeholder = 'Rövid képaláírás (nem kötelező)';
    captionInput.value = photo.caption || '';
    captionInput.dataset.photoId = photo.id;
    captionInput.dataset.photoProperty = 'caption';
    captionInput.disabled = currentInstallation.syncStatus !== 'draft';
    captionLabel.append(captionTitle, captionInput);

    const removeButton = document.createElement('button');
    removeButton.className = 'button photo-remove';
    removeButton.type = 'button';
    removeButton.textContent = 'Fénykép törlése';
    removeButton.dataset.removePhotoId = photo.id;
    removeButton.disabled = currentInstallation.syncStatus !== 'draft';
    card.append(preview, details, categoryLabel, captionLabel, removeButton);
    photosContainer.append(card);
  }
}

function photoValidationError(file, totalBytes) {
  if (!file.type.startsWith('image/')) return 'nem támogatott fájltípus';
  if (file.size === 0) return 'üres fájl';
  if (file.size > MAX_PHOTO_SIZE_BYTES) return 'meghaladja a képenkénti 15 MB-os korlátot';
  if (totalBytes + file.size > MAX_INSTALLATION_PHOTO_BYTES) return 'meghaladja a munkánkénti 50 MB-os tárhelykorlátot';
  return '';
}

async function addPhotos(files) {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return;
  const previousPhotos = currentInstallation.photos || [];
  const updatedPhotos = [...previousPhotos];
  let totalBytes = updatedPhotos.reduce((total, photo) => total + (photo.blob instanceof Blob ? photo.blob.size : 0), 0);
  const rejected = [];
  let addedCount = 0;

  for (const file of files) {
    const reason = photoValidationError(file, totalBytes);
    if (reason) {
      rejected.push(`${file.name}: ${reason}.`);
      continue;
    }
    const photo = {
      id: createId(),
      installationId: currentInstallation.id,
      category: 'site',
      caption: '',
      fileName: file.name,
      mimeType: file.type,
      blob: file,
      createdAt: new Date().toISOString()
    };
    updatedPhotos.push(photo);
    totalBytes += file.size;
    addedCount += 1;
  }

  if (addedCount === 0) {
    showNotice(rejected.length ? rejected.join(' ') : 'Nem választottál ki fényképet.', rejected.length > 0);
    return;
  }

  currentInstallation.photos = updatedPhotos;
  renderPhotos();
  try {
    await persistChangesNow();
    const message = `${addedCount} fénykép helyben elmentve.${rejected.length ? ` Nem mentett fájlok: ${rejected.join(' ')}` : ''}`;
    showNotice(message, rejected.length > 0);
  } catch (error) {
    currentInstallation.photos = previousPhotos;
    renderPhotos();
    reportError('A fényképek helyi mentése nem sikerült. Ellenőrizd az eszköz szabad tárhelyét, majd próbáld újra.', error);
  }
}

async function removePhoto(photoId) {
  if (!currentInstallation || currentInstallation.syncStatus !== 'draft') return;
  const previousPhotos = currentInstallation.photos;
  const removedPhoto = previousPhotos.find((photo) => photo.id === photoId);
  if (!removedPhoto) return;
  currentInstallation.photos = previousPhotos.filter((photo) => photo.id !== photoId);
  renderPhotos();
  try {
    await persistChangesNow();
    showNotice('A fénykép törölve a helyi kivitelezésből.');
  } catch (error) {
    currentInstallation.photos = previousPhotos;
    renderPhotos();
    reportError('A fénykép törlését nem sikerült helyben menteni.', error);
  }
}

async function finalizeInstallation() {
  finalizeButton.disabled = true;
  try {
    await flushPendingSave();
    readFormIntoInstallation();
    const missing = findMissingRequiredValues();
    if (missing.length || !installationForm.checkValidity()) {
      if (missing.length) {
        showNotice(`A véglegesítéshez töltsd ki a kötelező adatokat: ${missing.join('; ')}.`, true);
      } else {
        showNotice('Ellenőrizd a megadott értékek formátumát és tartományát.', true);
      }
      const firstRequired = installationForm.querySelector(':invalid');
      if (firstRequired) firstRequired.focus();
      return;
    }

    const finalizedAt = new Date().toISOString();
    currentInstallation.syncStatus = 'pending_upload';
    currentInstallation.finalizedAt = finalizedAt;
    currentInstallation.updatedAt = finalizedAt;
    for (const record of currentInstallation.documents) {
      const template = currentInstallation.templateSnapshots.find((item) => item.code === record.templateCode);
      record.completed = template.fields
        .filter((field) => field.required)
        .every((field) => fieldValueIsPresent(record.values[field.id]));
      if (record.completed) record.completedAt = finalizedAt;
    }
    await putInstallation(currentInstallation);
    showEditor(currentInstallation);
    showNotice('A kivitelezés helyben véglegesítve. Feltöltés és szerveroldali visszaigazolás nem történt.');
    await renderInstallationList();
  } catch (error) {
    reportError('A kivitelezés véglegesítése nem sikerült.', error);
  } finally {
    finalizeButton.disabled = false;
  }
}

function reportError(message, error) {
  console.error(message, error);
  showNotice(`${message} ${error instanceof Error ? error.message : 'Ismeretlen hiba.'}`, true);
}

function updateConnectionStatus() {
  const indicator = document.querySelector('#connection-state');
  const label = document.querySelector('#connection-label');
  const online = navigator.onLine;
  indicator.classList.toggle('is-offline', !online);
  label.textContent = online ? 'Online · helyi mentés aktív' : 'Offline · helyi mentés aktív';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    showNotice('Ez a böngésző nem támogatja az offline alkalmazáshéjat. A helyi mentés ettől még működhet.');
    return;
  }
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      showNotice('Új alkalmazásverzió érhető el. Töltsd újra az alkalmazást a frissítés használatához.');
    });
  }
  try {
    await navigator.serviceWorker.register(new URL('./sw.js', appBaseUrl), {
      scope: appBaseUrl.pathname,
      updateViaCache: 'none'
    });
  } catch (error) {
    console.error('A Service Worker regisztrációja nem sikerült.', error);
    showNotice('Az offline alkalmazáshéj nem aktiválódott. Nyisd meg az alkalmazást HTTPS-en, majd töltsd be újra.', true);
  }
}

async function startApp() {
  if (!window.indexedDB) {
    throw new Error('A böngésző nem támogatja a helyi IndexedDB-adatbázist.');
  }
  const [openedDatabase, loadedConfiguration] = await Promise.all([
    openDatabase(),
    loadConfiguration()
  ]);
  database = openedDatabase;
  configuration = loadedConfiguration;
  await renderInstallationList();
  updateConnectionStatus();
  await registerServiceWorker();
}

document.querySelector('#new-installation').addEventListener('click', async () => {
  try {
    const installation = createInstallation();
    await putInstallation(installation);
    showEditor(installation);
    await renderInstallationList();
    installationForm.elements.customerName.focus();
  } catch (error) {
    reportError('Új kivitelezést nem sikerült létrehozni.', error);
  }
});

document.querySelector('#back-to-home').addEventListener('click', async () => {
  try {
    await returnHome();
  } catch (error) {
    reportError('A módosításokat nem sikerült elmenteni.', error);
  }
});

installationForm.addEventListener('input', (event) => {
  if (event.target !== photoInput) scheduleSave();
});
installationForm.addEventListener('change', (event) => {
  if (event.target !== photoInput) scheduleSave();
});
photosContainer.addEventListener('input', (event) => {
  const input = event.target.closest('[data-photo-id][data-photo-property]');
  if (!input || !currentInstallation) return;
  const photo = currentInstallation.photos.find((item) => item.id === input.dataset.photoId);
  if (!photo || currentInstallation.syncStatus !== 'draft') return;
  photo[input.dataset.photoProperty] = input.value;
  if (input.dataset.photoProperty === 'caption') {
    const image = input.closest('.photo-card').querySelector('.photo-preview img');
    image.alt = input.value || photo.fileName;
  }
});
photosContainer.addEventListener('change', (event) => {
  const input = event.target.closest('[data-photo-id][data-photo-property]');
  if (!input || !currentInstallation) return;
  const photo = currentInstallation.photos.find((item) => item.id === input.dataset.photoId);
  if (photo && currentInstallation.syncStatus === 'draft') {
    photo[input.dataset.photoProperty] = input.value;
    scheduleSave();
  }
});
photosContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-photo-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await removePhoto(button.dataset.removePhotoId);
  } catch (error) {
    reportError('A fénykép törlése nem sikerült.', error);
  } finally {
    button.disabled = false;
  }
});
photoInput.addEventListener('change', async (event) => {
  event.stopPropagation();
  const files = Array.from(photoInput.files || []);
  photoInput.value = '';
  try {
    await addPhotos(files);
  } catch (error) {
    reportError('A fényképek feldolgozása nem sikerült.', error);
  }
});
signerNameInput.addEventListener('input', () => signerNameInput.setCustomValidity(''));
signatureCanvas.addEventListener('pointerdown', beginSignatureStroke);
signatureCanvas.addEventListener('pointermove', continueSignatureStroke);
signatureCanvas.addEventListener('pointerup', endSignatureStroke);
signatureCanvas.addEventListener('pointercancel', endSignatureStroke);
clearSignatureButton.addEventListener('click', clearSignatureCanvas);
acceptSignatureButton.addEventListener('click', acceptSignature);
signaturesContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-signature-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await removeSignature(button.dataset.removeSignatureId);
  } catch (error) {
    reportError('Az aláírás törlése nem sikerült.', error);
  } finally {
    button.disabled = false;
  }
});
finalizeButton.addEventListener('click', finalizeInstallation);
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

startApp().catch((error) => {
  console.error('Az alkalmazás indítása nem sikerült.', error);
  showNotice(`Az alkalmazás indítása nem sikerült: ${error instanceof Error ? error.message : 'ismeretlen hiba'}`, true);
  installationSummary.textContent = 'A helyi munkák betöltése nem sikerült.';
});
