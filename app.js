'use strict';

const PX_PER_MM = 96 / 25.4;
// Chrysanth's portrait/center-feed behavior places the narrow cheque stock
// in the middle of the A4 portrait feed path. Philippine cheque stock is
// approximately 90 mm tall, so after rotating the landscape report this
// becomes a 90 mm-wide vertical print strip on the portrait page.
const DEFAULT_CHEQUE_FEED_WIDTH_MM = 90;
const SETTINGS_KEY = 'cw.settings.v1';
const LAST_INPUT_KEY = 'cw.lastInput.v1';
const ACCOUNTS_KEY = 'cw.accounts.v1';
const PAYEES_KEY = 'cw.payees.v1';
const TRANSACTIONS_KEY = 'cw.transactions.v1';
const SELECTED_ACCOUNT_KEY = 'cw.selectedAccount.v1';

let recordsState = {accounts: [], payees: [], transactions: [], selectedAccountId: ''};

const $ = (id) => document.getElementById(id);
const els = {};
let templates = [];
let templateById = new Map();
let settings = null;
let showGuidesTransient = null;
let resizeTimer = null;

const defaultSettings = () => ({
  orientation: 'portrait',
  feed: 'default',
  paperFeedPath: 'center',
  xDirection: 'right',
  xPixels: 0,
  yDirection: 'down',
  yPixels: 0,
  shiftAcPayee: false,
  font: 'template',
  payeePrefix: '',
  payeeSuffix: '',
  longPayee: 'wrap',
  amountPrefix: '',
  amountSuffix: '',
  uppercaseWording: false,
  andStyle: 'us',
  dateFormat: 'mdy',
  showGuides: true,
  rememberInputs: false,
  selectedTemplateId: 'frxrptBDO',
  templateOffsets: {}
});

function safeLoadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaultSettings(),
      ...parsed,
      templateOffsets: parsed && parsed.templateOffsets && typeof parsed.templateOffsets === 'object' ? parsed.templateOffsets : {}
    };
    // Migration from early test builds: Chrysanth's application-level default
    // is Portrait even though the embedded FastReport cheque canvas is landscape.
    if (merged.orientation === 'template') merged.orientation = 'portrait';
    if (merged.feed === 'manual') merged.feed = 'default';
    if (!['center','side'].includes(merged.paperFeedPath)) merged.paperFeedPath = 'center';
    return merged;
  } catch (_) {
    return defaultSettings();
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function safeLoadLastInput() {
  if (!settings.rememberInputs) return null;
  try { return JSON.parse(localStorage.getItem(LAST_INPUT_KEY) || 'null'); }
  catch (_) { return null; }
}

function saveLastInputIfAllowed() {
  if (!settings.rememberInputs) {
    localStorage.removeItem(LAST_INPUT_KEY);
    return;
  }
  const payload = {
    date: els.dateInput.value,
    payee: els.payeeInput.value,
    amount: els.amountInput.value,
    crossing: els.crossingSelect.value,
    dateEnabled: els.dateEnabled.checked,
    payeeEnabled: els.payeeEnabled.checked,
    amountEnabled: els.amountEnabled.checked
  };
  localStorage.setItem(LAST_INPUT_KEY, JSON.stringify(payload));
}

function cacheElements() {
  [
    'templateSelect','templateMeta','dateEnabled','dateInput','payeeEnabled','payeeInput','clearPayeeBtn',
    'amountEnabled','amountInput','crossingSelect','wordingLocale','wordingPreview','previewGuidesBtn','printBtn',
    'printBtnTop','settingsBtn','previewViewport','sheet','printLayer','previewSize','offsetReadout','settingsModal',
    'orientationSetting','feedSetting','paperFeedPathSetting','feedPathGroup','printerFeedGuide','xDirection','xPixels','yDirection','yPixels','shiftAcPayee',
    'templateOffsetX','templateOffsetY','fontSetting','payeePrefix','payeeSuffix','longPayee','amountPrefix',
    'amountSuffix','uppercaseWording','andStyle','dateFormat','showGuidesSetting','rememberInputsSetting',
    'resetSettingsBtn','saveSettingsBtn'
  ].forEach(id => els[id] = $(id));
}

async function init() {
  cacheElements();
  settings = safeLoadSettings();

  const response = await fetch('templates.json', {cache: 'no-store'});
  if (!response.ok) throw new Error('Could not load cheque templates.');
  const data = await response.json();
  templates = data.templates || [];
  templateById = new Map(templates.map(t => [t.id, t]));

  fillTemplateSelect();
  applyInitialInput();
  bindEvents();
  initRecordsTools();
  render();
}

function fillTemplateSelect() {
  els.templateSelect.textContent = '';
  templates.forEach(t => {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.label;
    option.title = `${t.sourceBankLabel} • ${t.id}`;
    els.templateSelect.appendChild(option);
  });
  if (!templateById.has(settings.selectedTemplateId)) settings.selectedTemplateId = 'frxrptBDO';
  if (!templateById.has(settings.selectedTemplateId) && templates[0]) settings.selectedTemplateId = templates[0].id;
  els.templateSelect.value = settings.selectedTemplateId;
}

function applyInitialInput() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  els.dateInput.value = `${yyyy}-${mm}-${dd}`;

  const saved = safeLoadLastInput();
  if (!saved) return;
  if (saved.date) els.dateInput.value = saved.date;
  if (typeof saved.payee === 'string') els.payeeInput.value = saved.payee;
  if (typeof saved.amount === 'string') els.amountInput.value = saved.amount;
  if (saved.crossing) els.crossingSelect.value = saved.crossing;
  if (typeof saved.dateEnabled === 'boolean') els.dateEnabled.checked = saved.dateEnabled;
  if (typeof saved.payeeEnabled === 'boolean') els.payeeEnabled.checked = saved.payeeEnabled;
  if (typeof saved.amountEnabled === 'boolean') els.amountEnabled.checked = saved.amountEnabled;
}

function bindEvents() {
  const rerenderIds = ['dateEnabled','dateInput','payeeEnabled','payeeInput','amountEnabled','amountInput','crossingSelect'];
  rerenderIds.forEach(id => {
    els[id].addEventListener('input', () => { render(); saveLastInputIfAllowed(); });
    els[id].addEventListener('change', () => { render(); saveLastInputIfAllowed(); });
  });

  els.templateSelect.addEventListener('change', () => {
    settings.selectedTemplateId = els.templateSelect.value;
    saveSettings();
    render();
  });

  els.amountInput.addEventListener('blur', () => {
    const n = parseMoney(els.amountInput.value);
    if (Number.isFinite(n)) els.amountInput.value = formatMoney(n);
    render(); saveLastInputIfAllowed();
  });

  els.clearPayeeBtn.addEventListener('click', () => {
    els.payeeInput.value = '';
    els.payeeInput.focus();
    render(); saveLastInputIfAllowed();
  });

  els.previewGuidesBtn.addEventListener('click', () => {
    const current = showGuidesTransient === null ? settings.showGuides : showGuidesTransient;
    showGuidesTransient = !current;
    render();
  });

  [els.printBtn, els.printBtnTop].forEach(btn => btn.addEventListener('click', printCheque));
  els.settingsBtn.addEventListener('click', openSettings);
  els.feedSetting.addEventListener('change', updatePrinterSettingsUi);
  els.paperFeedPathSetting.addEventListener('change', updatePrinterSettingsUi);
  document.querySelectorAll('[data-close-settings]').forEach(el => el.addEventListener('click', closeSettings));
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  els.saveSettingsBtn.addEventListener('click', commitSettings);
  els.resetSettingsBtn.addEventListener('click', resetLocalSettings);

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scalePreview, 80);
  });
  window.addEventListener('afterprint', scalePreview);
}

function updatePrinterSettingsUi() {
  if (!els.feedSetting || !els.paperFeedPathSetting) return;
  const follow = els.feedSetting.value === 'follow-paper';
  els.paperFeedPathSetting.disabled = !follow;
  if (els.feedPathGroup) els.feedPathGroup.classList.toggle('is-disabled', !follow);
  if (els.printerFeedGuide) {
    const path = els.paperFeedPathSetting.value === 'side' ? 'side' : 'center';
    els.printerFeedGuide.dataset.path = path;
    els.printerFeedGuide.dataset.feed = follow ? 'follow' : 'default';
    const text = els.printerFeedGuide.querySelector('.feed-guide-text');
    if (text) text.textContent = follow
      ? `Follow Paper Feed • ${path === 'side' ? 'Side' : 'Center'} path`
      : 'Default cheque feed';
  }
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}

function openSettings() {
  loadSettingsForm();
  els.settingsModal.hidden = false;
  activateTab('printer');
}

function closeSettings() {
  els.settingsModal.hidden = true;
}

function loadSettingsForm() {
  els.orientationSetting.value = settings.orientation;
  els.feedSetting.value = settings.feed;
  els.paperFeedPathSetting.value = settings.paperFeedPath || 'center';
  updatePrinterSettingsUi();
  els.xDirection.value = settings.xDirection;
  els.xPixels.value = settings.xPixels;
  els.yDirection.value = settings.yDirection;
  els.yPixels.value = settings.yPixels;
  els.shiftAcPayee.checked = settings.shiftAcPayee;
  els.fontSetting.value = settings.font;
  els.payeePrefix.value = settings.payeePrefix;
  els.payeeSuffix.value = settings.payeeSuffix;
  els.longPayee.value = settings.longPayee;
  els.amountPrefix.value = settings.amountPrefix;
  els.amountSuffix.value = settings.amountSuffix;
  els.uppercaseWording.checked = settings.uppercaseWording;
  els.andStyle.value = settings.andStyle;
  els.dateFormat.value = settings.dateFormat;
  els.showGuidesSetting.checked = settings.showGuides;
  els.rememberInputsSetting.checked = settings.rememberInputs;
  const offset = settings.templateOffsets[currentTemplateId()] || {x:0,y:0};
  els.templateOffsetX.value = Number(offset.x || 0);
  els.templateOffsetY.value = Number(offset.y || 0);
}

function commitSettings() {
  const id = currentTemplateId();
  const nextOffsets = {...settings.templateOffsets};
  nextOffsets[id] = {
    x: clampNumber(els.templateOffsetX.value, -30, 30, 0),
    y: clampNumber(els.templateOffsetY.value, -30, 30, 0)
  };
  const rememberWasOn = settings.rememberInputs;
  settings = {
    ...settings,
    orientation: els.orientationSetting.value,
    feed: els.feedSetting.value,
    paperFeedPath: els.paperFeedPathSetting.value,
    xDirection: els.xDirection.value,
    xPixels: clampNumber(els.xPixels.value, 0, 500, 0),
    yDirection: els.yDirection.value,
    yPixels: clampNumber(els.yPixels.value, 0, 500, 0),
    shiftAcPayee: els.shiftAcPayee.checked,
    font: els.fontSetting.value,
    payeePrefix: els.payeePrefix.value,
    payeeSuffix: els.payeeSuffix.value,
    longPayee: els.longPayee.value,
    amountPrefix: els.amountPrefix.value,
    amountSuffix: els.amountSuffix.value,
    uppercaseWording: els.uppercaseWording.checked,
    andStyle: els.andStyle.value,
    dateFormat: els.dateFormat.value,
    showGuides: els.showGuidesSetting.checked,
    rememberInputs: els.rememberInputsSetting.checked,
    templateOffsets: nextOffsets,
    selectedTemplateId: id
  };
  showGuidesTransient = null;
  saveSettings();
  if (!settings.rememberInputs) localStorage.removeItem(LAST_INPUT_KEY);
  if (!rememberWasOn && settings.rememberInputs) saveLastInputIfAllowed();
  closeSettings();
  render();
}

function resetLocalSettings() {
  if (!window.confirm('Reset all local Cheque Writer settings and calibration?')) return;
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(LAST_INPUT_KEY);
  settings = defaultSettings();
  showGuidesTransient = null;
  els.templateSelect.value = templateById.has(settings.selectedTemplateId) ? settings.selectedTemplateId : templates[0].id;
  loadSettingsForm();
  render();
}

function currentTemplateId() { return els.templateSelect.value || settings.selectedTemplateId; }
function currentTemplate() { return templateById.get(currentTemplateId()) || templates[0]; }

function signedGlobalOffsetsMm() {
  const x = Number(settings.xPixels || 0) / PX_PER_MM * (settings.xDirection === 'left' ? -1 : 1);
  const y = Number(settings.yPixels || 0) / PX_PER_MM * (settings.yDirection === 'up' ? -1 : 1);
  return {x, y};
}

function templateOffsetsMm() {
  const o = settings.templateOffsets[currentTemplateId()] || {x:0,y:0};
  const account = currentAccountRecord();
  return {
    x:(Number(o.x)||0) + (account ? Number(account.offsetX || 0) : 0),
    y:(Number(o.y)||0) + (account ? Number(account.offsetY || 0) : 0)
  };
}

function actualPage(template) {
  const tw = Number(template.page.widthMm);
  const th = Number(template.page.heightMm);
  const templateLandscape = tw >= th;
  const targetPortrait = settings.orientation !== 'landscape';

  if (targetPortrait) {
    return {
      width: Math.min(tw, th),
      height: Math.max(tw, th),
      rotation: templateLandscape ? -90 : 0,
      templateWidth: tw,
      templateHeight: th
    };
  }
  return {
    width: Math.max(tw, th),
    height: Math.min(tw, th),
    rotation: templateLandscape ? 0 : 90,
    templateWidth: tw,
    templateHeight: th
  };
}

function chequeFeedStripWidthMm(page) {
  // The extracted FastReport page is A4, but only a cheque-height strip of it
  // is physically fed through the printer.  Chrysanth's Center feed positions
  // that strip in the middle of the portrait A4 path.
  return Math.min(DEFAULT_CHEQUE_FEED_WIDTH_MM, Number(page.width) || DEFAULT_CHEQUE_FEED_WIDTH_MM);
}

function chequeFeedLeftMm(page) {
  if (page.rotation !== -90 && page.rotation !== 90) return 0;
  const strip = chequeFeedStripWidthMm(page);
  const path = settings.feed === 'follow-paper' ? settings.paperFeedPath : 'center';
  if (path === 'side') return Math.max(0, page.width - strip);
  return Math.max(0, (page.width - strip) / 2);
}

function applyPrintLayerGeometry(page) {
  const tw = page.templateWidth;
  const th = page.templateHeight;
  const layer = els.printLayer;
  layer.style.inset = 'auto';
  layer.style.right = 'auto';
  layer.style.bottom = 'auto';
  layer.style.width = `${tw}mm`;
  layer.style.height = `${th}mm`;
  layer.style.transformOrigin = '0 0';

  // Chrysanth keeps the extracted report in landscape coordinates but prints
  // it on a PORTRAIT A4 path. The cheque itself is a narrow stock centered (or
  // side-fed) in that path, so the rotated report must be translated to the
  // cheque feed strip instead of being pinned to the left page edge.
  const feedLeft = chequeFeedLeftMm(page);
  if (page.rotation === -90) {
    layer.style.left = `${feedLeft}mm`;
    layer.style.top = `${tw}mm`;
    layer.style.transform = 'rotate(-90deg)';
  } else if (page.rotation === 90) {
    // Mirror the feed-strip positioning for the opposite report orientation.
    layer.style.left = `${feedLeft + th}mm`;
    layer.style.top = '0mm';
    layer.style.transform = 'rotate(90deg)';
  } else {
    layer.style.left = '0mm';
    layer.style.top = '0mm';
    layer.style.transform = 'none';
  }
}

function setDynamicPageStyle(width, height) {
  let style = $('dynamicPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dynamicPageStyle';
    document.head.appendChild(style);
  }
  const isA4 = Math.abs(Math.min(width,height) - 210) < 0.75 && Math.abs(Math.max(width,height) - 297) < 0.75;
  const orientation = width <= height ? 'portrait' : 'landscape';
  const pageSize = isA4 ? `A4 ${orientation}` : `${width}mm ${height}mm`;
  style.textContent = `@page { size: ${pageSize}; margin: 0; }`;
}

function render() {
  const template = currentTemplate();
  if (!template) return;
  settings.selectedTemplateId = template.id;

  const page = actualPage(template);
  els.sheet.style.width = `${page.width}mm`;
  els.sheet.style.height = `${page.height}mm`;
  els.printLayer.textContent = '';
  applyPrintLayerGeometry(page);
  setDynamicPageStyle(page.width, page.height);

  const globalOffset = signedGlobalOffsetsMm();
  const templateOffset = templateOffsetsMm();
  const guides = showGuidesTransient === null ? settings.showGuides : showGuidesTransient;
  const values = buildFieldValues(template);

  const amountWords = values.__amountWords || '';
  const amountFields = template.elements.filter(e => e.name === 'mmAmountText1' || e.name === 'mmAmountText2');
  const split = splitAmountWords(amountWords, amountFields);
  values.mmAmountText1 = split[0] || '';
  values.mmAmountText2 = split[1] || '';

  for (const e of template.elements) {
    if (e.name === 'mmBank') continue;
    if (!shouldRenderElement(e, values)) continue;

    const isAcCross = e.name === 'mmPayeeOnly' || e.name === 'lnPayee1' || e.name === 'lnPayee2';
    const useGlobal = !isAcCross || settings.shiftAcPayee;
    const dx = templateOffset.x + (useGlobal ? globalOffset.x : 0);
    const dy = templateOffset.y + (useGlobal ? globalOffset.y : 0);

    if (e.type === 'line') {
      const line = document.createElement('div');
      line.className = `print-line${guides ? ' guide' : ''}`;
      const rendered = crossingLineGeometry(template, e, values);
      const vx = Number(rendered.widthMm || 0), vy = Number(rendered.heightMm || 0);
      const length = Math.hypot(vx, vy);
      const angle = Math.atan2(vy, vx) * 180 / Math.PI;
      line.style.left = `${Number(rendered.leftMm) + dx}mm`;
      line.style.top = `${Number(rendered.topMm) + dy}mm`;
      line.style.width = `${length}mm`;
      line.style.transform = `rotate(${angle}deg)`;
      els.printLayer.appendChild(line);
      continue;
    }

    const text = values[e.name] ?? '';
    if (!text) continue;

    // FastReport rotates text *inside* the memo rectangle. Rotating the whole
    // CSS rectangle around its top-left corner clips BDO's A/C PAYEE ONLY.
    // For crossing text, anchor it midway between the two extracted crossing
    // lines and rotate along their actual slope. This reproduces the printed
    // FastReport geometry much more closely.
    if (e.name === 'mmPayeeOnly') {
      renderCrossingText(template, e, text, dx, dy, guides);
      continue;
    }

    const node = document.createElement('div');
    node.className = `print-element${guides ? ' guide' : ''}`;
    node.textContent = text;
    node.style.left = `${Number(e.leftMm) + dx}mm`;
    node.style.top = `${Number(e.topMm) + dy}mm`;
    node.style.width = `${Math.max(0,Number(e.widthMm))}mm`;
    node.style.height = `${Math.max(0,Number(e.heightMm))}mm`;
    node.style.fontFamily = settings.font === 'template' ? (e.fontName || 'Arial') : settings.font;
    node.style.fontSize = `${Number(e.fontHeightPx || 15)}px`;
    node.style.fontWeight = (e.fontStyle || []).includes('fsBold') ? '700' : '400';
    node.style.fontStyle = (e.fontStyle || []).includes('fsItalic') ? 'italic' : 'normal';
    node.style.textDecoration = (e.fontStyle || []).includes('fsUnderline') ? 'underline' : 'none';
    node.style.textAlign = e.hAlign === 'haRight' ? 'right' : e.hAlign === 'haCenter' ? 'center' : 'left';
    node.style.display = 'flex';
    node.style.justifyContent = e.hAlign === 'haRight' ? 'flex-end' : e.hAlign === 'haCenter' ? 'center' : 'flex-start';
    node.style.alignItems = e.vAlign === 'vaCenter' ? 'center' : e.vAlign === 'vaBottom' ? 'flex-end' : 'flex-start';
    if (Number(e.rotation)) node.style.transform = `rotate(${-Number(e.rotation)}deg)`;

    if (e.name === 'mmPayee') applyPayeeOverflow(node, e);
    if (e.name === 'mmAmountText1' || e.name === 'mmAmountText2') shrinkToFit(node, e, 8);
    if (e.name === 'mmAmount') shrinkToFit(node, e, 8);
    if (e.name === 'mmPayeeOnly' && values.__notNegotiable) {
      node.style.whiteSpace = 'pre';
      node.style.lineHeight = '.95';
    }
    els.printLayer.appendChild(node);
  }

  const source = template.sourceBankLabel || template.label;
  els.templateMeta.textContent = `${source} • ${template.id} • extracted FastReport layout`;
  els.previewSize.textContent = `${page.width.toFixed(2)} × ${page.height.toFixed(2)} mm`;
  const finalX = templateOffset.x + globalOffset.x;
  const finalY = templateOffset.y + globalOffset.y;
  const feedLabel = settings.feed === 'follow-paper' ? `Follow Paper Feed / ${settings.paperFeedPath === 'side' ? 'Side' : 'Center'}` : 'Default Feed / Center';
  const feedLeft = chequeFeedLeftMm(page);
  els.offsetReadout.textContent = `${settings.orientation === 'landscape' ? 'Landscape' : 'Portrait'} • ${feedLabel} • Feed X ${feedLeft.toFixed(2)} mm • Global ${globalOffset.x.toFixed(2)}, ${globalOffset.y.toFixed(2)} mm • Template + Account ${templateOffset.x.toFixed(2)}, ${templateOffset.y.toFixed(2)} mm`;
  els.wordingPreview.textContent = amountWords || 'Enter an amount to generate cheque wording.';
  els.wordingLocale.textContent = `English • ${settings.andStyle === 'uk' ? 'UK' : 'US'} style`;
  scalePreview();
}

function renderCrossingText(template, e, text, dx, dy, guides) {
  const values = buildFieldValues(template);
  const rawLine1 = template.elements.find(item => item.name === 'lnPayee1');
  const rawLine2 = template.elements.find(item => item.name === 'lnPayee2');
  const line1 = rawLine1 ? crossingLineGeometry(template, rawLine1, values) : null;
  const line2 = rawLine2 ? crossingLineGeometry(template, rawLine2, values) : null;

  // All Philippine cheque templates in the extracted Chrysanth library use
  // lnPayee1/lnPayee2 as the crossing strip and mmPayeeOnly as its label.
  // Render the label in a *rotated local coordinate system* whose X axis
  // follows the diagonal lines and whose Y axis sits perpendicular to them.
  // This is important: translating the text in normal page coordinates before
  // rotation makes it appear above/below the crossing on every bank template.
  let angle = -Number(e.rotation || 0);
  let anchorX = Number(e.leftMm || 0);
  let anchorY = Number(e.topMm || 0) + Number(e.heightMm || 0) / 2;
  let stripGapMm = 6;
  let usableWidthMm = Math.max(30, Number(e.widthMm || 0));

  if (line1 && line2) {
    const vx1 = Number(line1.widthMm || 0);
    const vy1 = Number(line1.heightMm || 0);
    const vx2 = Number(line2.widthMm || 0);
    const vy2 = Number(line2.heightMm || 0);

    const a1 = Math.atan2(vy1, vx1);
    const a2 = Math.atan2(vy2, vx2);
    // The extracted lines are parallel, but average their unit vectors so the
    // routine remains stable if a legacy bank layout differs by a fraction.
    const ux = Math.cos(a1) + Math.cos(a2);
    const uy = Math.sin(a1) + Math.sin(a2);
    const a = (Math.abs(ux) + Math.abs(uy)) > 0.000001 ? Math.atan2(uy, ux) : a1;
    angle = a * 180 / Math.PI;

    // Use the memo's original X coordinate (from Chrysanth) but place its
    // baseline exactly on the geometric midline between the two crossing lines.
    const y1 = lineYAtX(line1, anchorX);
    const y2 = lineYAtX(line2, anchorX);
    if (Number.isFinite(y1) && Number.isFinite(y2)) {
      anchorY = (y1 + y2) / 2;
      // Convert the vertical distance to true perpendicular strip spacing.
      stripGapMm = Math.abs(y2 - y1) * Math.abs(Math.cos(a));
    }

    // Do not let the label run beyond the shared visible diagonal area.
    const line1Len = Math.hypot(vx1, vy1);
    const line2Len = Math.hypot(vx2, vy2);
    usableWidthMm = Math.max(22, Math.min(Number(e.widthMm || 34), Math.min(line1Len, line2Len) - 2));
  }

  const anchor = document.createElement('div');
  anchor.className = `crossing-anchor${guides ? ' guide' : ''}`;
  anchor.style.left = `${anchorX + dx}mm`;
  anchor.style.top = `${anchorY + dy}mm`;
  anchor.style.transform = `rotate(${angle}deg)`;

  const node = document.createElement('div');
  node.className = 'print-element crossing-text';
  node.style.width = `${usableWidthMm}mm`;
  node.style.fontFamily = settings.font === 'template' ? (e.fontName || 'Arial') : settings.font;
  node.style.fontWeight = (e.fontStyle || []).includes('fsBold') ? '700' : '400';
  node.style.fontStyle = (e.fontStyle || []).includes('fsItalic') ? 'italic' : 'normal';
  node.style.textDecoration = (e.fontStyle || []).includes('fsUnderline') ? 'underline' : 'none';
  node.style.transform = 'translateY(-50%)';

  const rows = String(text).split(/\n/).filter(Boolean);
  const lineCount = Math.max(1, rows.length);
  const templatePx = Math.abs(Number(e.fontHeightPx || 11));
  // Chrysanth keeps the crossing font size constant. When a second line
  // (NOT NEGOTIABLE) is enabled, the *crossing strip expands* instead of
  // shrinking the words. crossingLineGeometry() moves the two diagonal lines
  // apart symmetrically, so the label can remain at the template font size.
  node.style.fontSize = `${templatePx}px`;
  node.style.lineHeight = lineCount > 1 ? '1.02' : '1';

  rows.forEach(lineText => {
    const row = document.createElement('span');
    row.textContent = lineText;
    node.appendChild(row);
  });

  anchor.appendChild(node);
  els.printLayer.appendChild(anchor);
}

function crossingLineGeometry(template, line, values) {
  if (!line || (line.name !== 'lnPayee1' && line.name !== 'lnPayee2')) return line;
  if (!values || !values.__notNegotiable) return line;

  const raw1 = template.elements.find(item => item.name === 'lnPayee1');
  const raw2 = template.elements.find(item => item.name === 'lnPayee2');
  const memo = template.elements.find(item => item.name === 'mmPayeeOnly');
  if (!raw1 || !raw2) return line;

  const a1 = Math.atan2(Number(raw1.heightMm || 0), Number(raw1.widthMm || 0));
  const a2 = Math.atan2(Number(raw2.heightMm || 0), Number(raw2.widthMm || 0));
  const ux = Math.cos(a1) + Math.cos(a2);
  const uy = Math.sin(a1) + Math.sin(a2);
  const a = (Math.abs(ux) + Math.abs(uy)) > 0.000001 ? Math.atan2(uy, ux) : a1;
  const nx = -Math.sin(a);
  const ny = Math.cos(a);

  const mid1 = {
    x: Number(raw1.leftMm || 0) + Number(raw1.widthMm || 0) / 2,
    y: Number(raw1.topMm || 0) + Number(raw1.heightMm || 0) / 2
  };
  const mid2 = {
    x: Number(raw2.leftMm || 0) + Number(raw2.widthMm || 0) / 2,
    y: Number(raw2.topMm || 0) + Number(raw2.heightMm || 0) / 2
  };
  const center = {x: (mid1.x + mid2.x) / 2, y: (mid1.y + mid2.y) / 2};
  const signed1 = (mid1.x - center.x) * nx + (mid1.y - center.y) * ny;
  const signed2 = (mid2.x - center.x) * nx + (mid2.y - center.y) * ny;
  const baseGapMm = Math.abs(signed2 - signed1);

  // Keep the original font. Two rows need roughly two text-heights plus
  // breathing room. This mirrors Chrysanth's behavior visible on paper: the
  // diagonal lines move apart while the words stay the same physical size.
  const fontPx = Math.abs(Number((memo && memo.fontHeightPx) || 11));
  const fontMm = fontPx / PX_PER_MM;
  const targetGapMm = Math.max(baseGapMm, fontMm * 2.15 + 1.6);
  const halfTarget = targetGapMm / 2;
  const sign = line.name === 'lnPayee1' ? (signed1 <= signed2 ? -1 : 1) : (signed2 >= signed1 ? 1 : -1);
  const sourceMid = line.name === 'lnPayee1' ? mid1 : mid2;
  const sourceSigned = line.name === 'lnPayee1' ? signed1 : signed2;
  const desiredSigned = sign * halfTarget;
  const delta = desiredSigned - sourceSigned;

  return {
    ...line,
    leftMm: Number(line.leftMm || 0) + nx * delta,
    topMm: Number(line.topMm || 0) + ny * delta
  };
}

function lineYAtX(line, x) {
  const left = Number(line.leftMm || 0);
  const top = Number(line.topMm || 0);
  const width = Number(line.widthMm || 0);
  const height = Number(line.heightMm || 0);
  if (Math.abs(width) < 0.000001) return top;
  return top + height * ((x - left) / width);
}

function shouldRenderElement(e, values) {
  if (e.name === 'mmPayeeOnly') return values.__crossLines && values.__acPayee;
  if (e.name === 'mmNoBearer') return values.__noBearer;
  if (e.name === 'lnPayee1' || e.name === 'lnPayee2') return values.__crossLines;
  if (e.name === 'mmAmountText2') return e.visible && Number(e.widthMm) > 0.1 && Boolean(values.mmAmountText2);
  if (e.name === 'mmMMM') {
    if (settings.dateFormat === 'text') return values.__dateEnabled;
    return e.visible && values.__dateEnabled;
  }
  if (['mmM1','mmM2','mmD1','mmD2','mmY1','mmY2','mmY3','mmY4','mmS1','mmS2'].includes(e.name)) {
    if (!values.__dateEnabled) return false;
    if (settings.dateFormat === 'text' && ['mmM1','mmM2','mmS1','mmS2'].includes(e.name)) return false;
    return e.visible;
  }
  if (!e.visible) return false;
  return Boolean(values[e.name]);
}

function buildFieldValues(template) {
  const amount = parseMoney(els.amountInput.value);
  let words = els.amountEnabled.checked && Number.isFinite(amount) ? moneyToWords(amount, settings.andStyle) : '';
  words = `${settings.amountPrefix || ''}${words}${settings.amountSuffix || ''}`.trim();
  if (settings.uppercaseWording) words = words.toUpperCase();

  const payee = els.payeeEnabled.checked ? `${settings.payeePrefix || ''}${els.payeeInput.value || ''}${settings.payeeSuffix || ''}`.trim() : '';
  const crossing = els.crossingSelect.value;
  const d = parseDateInput(els.dateInput.value);
  const dateEnabled = els.dateEnabled.checked && Boolean(d);

  const v = {
    mmPayee: payee,
    mmAmount: els.amountEnabled.checked && Number.isFinite(amount) ? formatMoney(amount) : '',
    mmAmountText1: words,
    mmAmountText2: '',
    mmPayeeOnly: crossing === 'ac-notneg-bearer' ? 'A/C PAYEE ONLY\nNOT NEGOTIABLE' : 'A/C PAYEE ONLY',
    mmNoBearer: 'XXXXXXX',
    __amountWords: words,
    __crossLines: crossing !== 'none',
    __acPayee: crossing === 'ac-bearer' || crossing === 'ac-notneg-bearer' || crossing === 'ac-nobearer',
    __notNegotiable: crossing === 'ac-notneg-bearer',
    __noBearer: crossing === 'ac-bearer' || crossing === 'ac-notneg-bearer',
    __dateEnabled: dateEnabled
  };

  if (!dateEnabled) return v;
  const month = String(d.month).padStart(2,'0');
  const day = String(d.day).padStart(2,'0');
  const year = String(d.year).padStart(4,'0');
  const first = settings.dateFormat === 'dmy' ? day : month;
  const second = settings.dateFormat === 'dmy' ? month : day;
  v.mmM1 = first[0]; v.mmM2 = first[1];
  v.mmD1 = second[0]; v.mmD2 = second[1];
  // Component creation order in the source reports is Y3,Y4,Y1,Y2 from left-to-right.
  v.mmY3 = year[0]; v.mmY4 = year[1]; v.mmY1 = year[2]; v.mmY2 = year[3];
  v.mmS1 = '/'; v.mmS2 = '/';
  v.mmMMM = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.month - 1];
  return v;
}

function parseDateInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {year, month, day};
}

function applyPayeeOverflow(node, e) {
  if (settings.longPayee === 'wrap') {
    node.classList.add('wrap');
    node.style.whiteSpace = 'normal';
    const minTwoLinesMm = (Number(e.fontHeightPx || 15) * 2.1) / PX_PER_MM;
    node.style.height = `${Math.max(Number(e.heightMm || 0), minTwoLinesMm)}mm`;
  } else if (settings.longPayee === 'clip') {
    node.classList.add('clip');
    node.style.whiteSpace = 'nowrap';
  } else {
    node.style.whiteSpace = 'nowrap';
    shrinkToFit(node, e, 8);
  }
}

function shrinkToFit(node, e, minPx) {
  requestAnimationFrame(() => {
    let size = Number(e.fontHeightPx || 15);
    const maxPx = Math.max(1, Number(e.widthMm || 0) * PX_PER_MM);
    const canvas = shrinkToFit.canvas || (shrinkToFit.canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const fontFamily = settings.font === 'template' ? (e.fontName || 'Arial') : settings.font;
    const text = node.textContent || '';
    while (size > minPx) {
      ctx.font = `${size}px ${fontFamily}`;
      if (ctx.measureText(text).width <= maxPx) break;
      size -= .5;
    }
    node.style.fontSize = `${size}px`;
  });
}

function splitAmountWords(text, fields) {
  const one = fields.find(e => e.name === 'mmAmountText1');
  const two = fields.find(e => e.name === 'mmAmountText2');
  if (!one || !two || !two.visible || Number(two.widthMm) <= 0.5) return [text, ''];
  const fontPx = Number(one.fontHeightPx || 15);
  const fontFamily = settings.font === 'template' ? (one.fontName || 'Arial') : settings.font;
  const max1 = Number(one.widthMm || 0) * PX_PER_MM;
  const max2 = Number(two.widthMm || 0) * PX_PER_MM;
  const canvas = splitAmountWords.canvas || (splitAmountWords.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontPx}px ${fontFamily}`;
  if (ctx.measureText(text).width <= max1) return [text,''];
  const words = text.split(/\s+/).filter(Boolean);
  let line1 = '', line2 = '';
  for (const word of words) {
    const candidate = line1 ? `${line1} ${word}` : word;
    if (ctx.measureText(candidate).width <= max1 || !line1) line1 = candidate;
    else line2 = line2 ? `${line2} ${word}` : word;
  }
  if (line2 && ctx.measureText(line2).width > max2) return [text,''];
  return [line1,line2];
}

function scalePreview() {
  const template = currentTemplate();
  if (!template) return;
  const page = actualPage(template);
  const style = getComputedStyle(els.previewViewport);
  const padX = parseFloat(style.paddingLeft || 0) + parseFloat(style.paddingRight || 0);
  const padY = parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
  const pageWidthPx = page.width * PX_PER_MM;
  const pageHeightPx = page.height * PX_PER_MM;
  const available = Math.max(260, els.previewViewport.clientWidth - padX);
  const scale = Math.min(1, available / pageWidthPx);
  els.sheet.style.transform = `scale(${scale})`;
  els.previewViewport.style.height = `${Math.max(360, pageHeightPx * scale + padY)}px`;
}

function printCheque() {
  render();
  saveLastInputIfAllowed();
  setTimeout(() => window.print(), 60);
}

function parseMoney(value) {
  const clean = String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,'');
  if (!clean || clean === '-' || clean === '.') return NaN;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatMoney(n) {
  return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:true});
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max,Math.max(min,n));
}

const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function underThousand(n, style) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n/100)]} Hundred`);
    n %= 100;
    if (n && style === 'uk') parts.push('and');
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n/10)]);
    if (n % 10) parts.push(ONES[n%10]);
  } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

function integerToWords(num, style='us') {
  num = Math.floor(Math.abs(num));
  if (num === 0) return 'Zero';
  const scales = [
    [1_000_000_000_000,'Trillion'],
    [1_000_000_000,'Billion'],
    [1_000_000,'Million'],
    [1_000,'Thousand'],
    [1,'']
  ];
  const out = [];
  for (const [scale,label] of scales) {
    if (num >= scale) {
      const chunk = Math.floor(num/scale);
      num %= scale;
      if (chunk) {
        const text = underThousand(chunk,style);
        out.push(label ? `${text} ${label}` : text);
      }
    }
  }
  return out.join(' ');
}

function moneyToWords(amount, style='us') {
  const totalCents = Math.round(amount * 100);
  const pesos = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  const pesoWord = pesos === 1 ? 'Peso' : 'Pesos';
  let text = `${integerToWords(pesos,style)} ${pesoWord}`;
  if (cents) text += ` and ${String(cents).padStart(2,'0')}/100`;
  return `${text} Only`;
}



// ---------------------------------------------------------------------------
// Local records & Chrysanth-style tools
// ---------------------------------------------------------------------------
function loadJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function newId(prefix='id') {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function currentAccountRecord() {
  const id = recordsState && recordsState.selectedAccountId;
  return id ? recordsState.accounts.find(a => a.id === id) || null : null;
}

function initRecordsTools() {
  recordsState = {
    accounts: loadJsonArray(ACCOUNTS_KEY),
    payees: loadJsonArray(PAYEES_KEY),
    transactions: loadJsonArray(TRANSACTIONS_KEY),
    selectedAccountId: localStorage.getItem(SELECTED_ACCOUNT_KEY) || ''
  };
  if (!recordsState.accounts.some(a => a.id === recordsState.selectedAccountId)) recordsState.selectedAccountId = '';
  refreshAccountSelect();

  const accountSelect = $('accountSelect');
  accountSelect.addEventListener('change', () => {
    recordsState.selectedAccountId = accountSelect.value;
    localStorage.setItem(SELECTED_ACCOUNT_KEY, recordsState.selectedAccountId);
    const account = currentAccountRecord();
    if (account) {
      if (templateById.has(account.templateId)) {
        els.templateSelect.value = account.templateId;
        settings.selectedTemplateId = account.templateId;
      }
      if (account.defaultCrossing) els.crossingSelect.value = account.defaultCrossing;
      saveSettings();
    }
    render();
  });

  const fileBtn = $('fileMenuBtn'), toolsBtn = $('toolsMenuBtn');
  fileBtn.addEventListener('click', e => { e.stopPropagation(); toggleAppMenu('fileMenu', fileBtn); });
  toolsBtn.addEventListener('click', e => { e.stopPropagation(); toggleAppMenu('toolsMenu', toolsBtn); });
  document.addEventListener('click', () => closeAppMenus());
  [$('fileMenu'), $('toolsMenu')].forEach(menu => {
    menu.addEventListener('click', e => {
      e.stopPropagation();
      const btn = e.target.closest('[data-tool-action]');
      if (!btn) return;
      closeAppMenus();
      runToolAction(btn.dataset.toolAction);
    });
  });

  [$('saveRecordBtn'), $('saveRecordBtnTop')].forEach(btn => btn.addEventListener('click', () => runToolAction('save-details')));
  document.querySelectorAll('[data-close-tool-modal]').forEach(el => el.addEventListener('click', closeToolModal));
  $('csvImportInput').addEventListener('change', importTransactionsCsvFile);
  $('backupImportInput').addEventListener('change', importBackupFile);
}

function refreshAccountSelect() {
  const select = $('accountSelect');
  if (!select) return;
  select.textContent = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'No saved account / use template directly';
  select.appendChild(blank);
  recordsState.accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name}${a.accountLabel ? ` • ${a.accountLabel}` : ''}`;
    select.appendChild(opt);
  });
  select.value = recordsState.selectedAccountId || '';
}

function toggleAppMenu(id, button) {
  const target = $(id);
  const shouldOpen = target.hidden;
  closeAppMenus();
  if (shouldOpen) {
    target.hidden = false;
    button.setAttribute('aria-expanded','true');
  }
}

function closeAppMenus() {
  ['fileMenu','toolsMenu'].forEach(id => { const m=$(id); if (m) m.hidden=true; });
  ['fileMenuBtn','toolsMenuBtn'].forEach(id => { const b=$(id); if (b) b.setAttribute('aria-expanded','false'); });
}

function openToolModal(title, build, footerBuilder) {
  $('toolModalTitle').textContent = title;
  const body = $('toolModalBody'), foot = $('toolModalFoot');
  body.textContent = '';
  foot.textContent = '';
  build(body);
  if (footerBuilder) footerBuilder(foot);
  else addModalCloseButton(foot);
  $('toolModal').hidden = false;
}

function closeToolModal() { $('toolModal').hidden = true; }

function addModalCloseButton(foot, label='Close') {
  const b = document.createElement('button');
  b.type='button'; b.className='button ghost'; b.textContent=label;
  b.addEventListener('click', closeToolModal); foot.appendChild(b);
}

function field(labelText, input) {
  const label = document.createElement('label');
  label.className = 'tool-field';
  const span = document.createElement('span'); span.textContent = labelText;
  label.append(span, input); return label;
}

function textInput(value='', max=120, placeholder='') {
  const input=document.createElement('input'); input.type='text'; input.maxLength=max; input.value=value; input.placeholder=placeholder; return input;
}

function numberInput(value=0, step='0.1') {
  const input=document.createElement('input'); input.type='number'; input.step=step; input.value=value; input.min='-30'; input.max='30'; return input;
}

function selectInput(options, value='') {
  const select=document.createElement('select');
  options.forEach(([v,t]) => { const o=document.createElement('option'); o.value=v; o.textContent=t; select.appendChild(o); });
  select.value=value; return select;
}

function runToolAction(action) {
  const actions = {
    accounts: openAccountsManager,
    payees: openPayeesManager,
    'save-details': openSaveDetails,
    history: openTransactionHistory,
    reconciliation: openReconciliation,
    'cash-flow': openCashFlow,
    'batch-print': openBatchPrint,
    'import-csv': () => $('csvImportInput').click(),
    report: openTransactionReport,
    'account-printing': () => openAccountsManager(true),
    'export-csv': exportTransactionsCsv,
    'network-share': openNetworkShareInfo,
    'data-backup': openDataBackup
  };
  if (actions[action]) actions[action]();
}

function openAccountsManager(focusPrinting=false) {
  openToolModal(focusPrinting ? 'Account Based Printing & Printer Adjustment' : 'Accounts', body => {
    const grid=document.createElement('div'); grid.className='tool-grid';
    const name=textInput('',60,'e.g. BDO Operating');
    const label=textInput('',40,'e.g. •••• 4821');
    const template=selectInput(templates.map(t => [t.id,t.label]), currentTemplateId());
    const x=numberInput(0), y=numberInput(0);
    const crossing=selectInput([
      ['ac-bearer','Cross A/C Payee + Or Bearer'],
      ['ac-notneg-bearer','Cross A/C Payee + Not Negotiable + Or Bearer'],
      ['ac-nobearer','Cross A/C Payee'], ['cross-only','Cross Only'], ['none','No Crossing']
    ], els.crossingSelect.value);
    grid.append(field('Account name',name),field('Masked account label (optional)',label),field('Bank / cheque template',template),field('Default crossing',crossing),field('Account X offset (mm)',x),field('Account Y offset (mm)',y));
    body.appendChild(grid);
    const note=document.createElement('div'); note.className='info-box'; note.textContent='Account offsets are added on top of the global and template calibration. Use these for account-specific printer fine-tuning without changing the bank template itself.'; body.appendChild(note);
    const save=document.createElement('button'); save.className='button primary'; save.type='button'; save.textContent='Add Account'; body.appendChild(save);
    const list=document.createElement('div'); list.className='record-list'; body.appendChild(list);
    const renderList=()=>{
      list.textContent='';
      if (!recordsState.accounts.length) { const e=document.createElement('div');e.className='empty-state';e.textContent='No saved accounts yet.';list.appendChild(e);return; }
      recordsState.accounts.forEach(a=>{
        const row=document.createElement('div');row.className='record-card';
        const meta=document.createElement('div'); const strong=document.createElement('strong');strong.textContent=a.name; const small=document.createElement('small');small.textContent=`${a.accountLabel||'No account number stored'} • ${(templateById.get(a.templateId)||{}).label||a.templateId} • X ${Number(a.offsetX||0).toFixed(1)} / Y ${Number(a.offsetY||0).toFixed(1)} mm`;meta.append(strong,small);
        const acts=document.createElement('div');acts.className='record-actions';
        const use=document.createElement('button');use.className='button ghost mini';use.textContent='Use';use.addEventListener('click',()=>{recordsState.selectedAccountId=a.id;localStorage.setItem(SELECTED_ACCOUNT_KEY,a.id);refreshAccountSelect();if(templateById.has(a.templateId)){els.templateSelect.value=a.templateId;settings.selectedTemplateId=a.templateId;}if(a.defaultCrossing)els.crossingSelect.value=a.defaultCrossing;saveSettings();render();closeToolModal();});
        const edit=document.createElement('button');edit.className='button ghost mini';edit.textContent='Edit';edit.addEventListener('click',()=>{name.value=a.name;label.value=a.accountLabel||'';template.value=a.templateId;x.value=a.offsetX||0;y.value=a.offsetY||0;crossing.value=a.defaultCrossing||'ac-bearer';save.textContent='Save Changes';save.dataset.editId=a.id;});
        const del=document.createElement('button');del.className='button danger mini';del.textContent='Remove';del.addEventListener('click',()=>{if(!confirm(`Remove account “${a.name}”?`))return;recordsState.accounts=recordsState.accounts.filter(v=>v.id!==a.id);if(recordsState.selectedAccountId===a.id)recordsState.selectedAccountId='';writeJson(ACCOUNTS_KEY,recordsState.accounts);localStorage.setItem(SELECTED_ACCOUNT_KEY,recordsState.selectedAccountId);refreshAccountSelect();renderList();render();});
        acts.append(use,edit,del);row.append(meta,acts);list.appendChild(row);
      });
    };
    save.addEventListener('click',()=>{
      const n=name.value.trim(); if(!n){alert('Enter an account name.');return;}
      const rec={id:save.dataset.editId||newId('acct'),name:n.slice(0,60),accountLabel:label.value.trim().slice(0,40),templateId:template.value,defaultCrossing:crossing.value,offsetX:clampNumber(x.value,-30,30,0),offsetY:clampNumber(y.value,-30,30,0)};
      const idx=recordsState.accounts.findIndex(a=>a.id===rec.id); if(idx>=0) recordsState.accounts[idx]=rec; else recordsState.accounts.push(rec);
      writeJson(ACCOUNTS_KEY,recordsState.accounts); delete save.dataset.editId; save.textContent='Add Account'; name.value='';label.value='';x.value='0';y.value='0';refreshAccountSelect();renderList();render();
    });
    renderList();
  });
}

function openPayeesManager() {
  openToolModal('Payees', body => {
    const bar=document.createElement('div');bar.className='tool-inline';
    const name=textInput(els.payeeInput.value,120,'Payee name');
    const note=textInput('',80,'Note (optional)');
    const add=document.createElement('button');add.className='button primary';add.textContent='Save Payee';
    bar.append(name,note,add);body.appendChild(bar);
    const list=document.createElement('div');list.className='record-list';body.appendChild(list);
    const renderList=()=>{list.textContent='';if(!recordsState.payees.length){const e=document.createElement('div');e.className='empty-state';e.textContent='No saved payees yet.';list.appendChild(e);return;}recordsState.payees.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{const row=document.createElement('div');row.className='record-card';const meta=document.createElement('div');const st=document.createElement('strong');st.textContent=p.name;const sm=document.createElement('small');sm.textContent=p.note||'';meta.append(st,sm);const acts=document.createElement('div');acts.className='record-actions';const use=document.createElement('button');use.className='button ghost mini';use.textContent='Use';use.addEventListener('click',()=>{els.payeeInput.value=p.name;render();saveLastInputIfAllowed();closeToolModal();});const del=document.createElement('button');del.className='button danger mini';del.textContent='Remove';del.addEventListener('click',()=>{recordsState.payees=recordsState.payees.filter(v=>v.id!==p.id);writeJson(PAYEES_KEY,recordsState.payees);renderList();});acts.append(use,del);row.append(meta,acts);list.appendChild(row);});};
    add.addEventListener('click',()=>{const n=name.value.trim();if(!n)return;const existing=recordsState.payees.find(p=>p.name.toLowerCase()===n.toLowerCase());if(existing){existing.note=note.value.trim().slice(0,80);}else recordsState.payees.push({id:newId('payee'),name:n.slice(0,120),note:note.value.trim().slice(0,80)});writeJson(PAYEES_KEY,recordsState.payees);name.value='';note.value='';renderList();});
    renderList();
  });
}

function currentChequeSnapshot(extra={}) {
  const amount=parseMoney(els.amountInput.value);
  return {
    id:newId('txn'), date:els.dateInput.value||'', payee:(els.payeeInput.value||'').trim().slice(0,120),
    amount:Number.isFinite(amount)?amount:0, crossing:els.crossingSelect.value, templateId:currentTemplateId(),
    accountId:recordsState.selectedAccountId||'', chequeNo:'', remark:'', status:'issued', createdAt:new Date().toISOString(), ...extra
  };
}

function openSaveDetails() {
  openToolModal('Save Cheque Details', body => {
    const grid=document.createElement('div');grid.className='tool-grid';
    const chequeNo=textInput('',40,'Cheque No.'); const remark=textInput('',120,'Remark / reference');
    const status=selectInput([['draft','Draft'],['printed','Printed'],['issued','Issued'],['cleared','Cleared'],['voided','Voided']],'issued');
    const summary=document.createElement('div');summary.className='summary-card';summary.textContent=`${els.payeeInput.value||'(no payee)'} • ${formatMoney(parseMoney(els.amountInput.value)||0)} • ${els.dateInput.value||'no date'}`;
    grid.append(field('Cheque No.',chequeNo),field('Remark',remark),field('Status',status));body.append(summary,grid);
    const note=document.createElement('div');note.className='info-box';note.textContent='This explicitly saves the cheque record in this browser only. It is not uploaded to Vercel or any server.';body.appendChild(note);
    const save=document.createElement('button');save.className='button primary';save.textContent='Save Cheque Record';body.appendChild(save);
    save.addEventListener('click',()=>{const t=currentChequeSnapshot({chequeNo:chequeNo.value.trim().slice(0,40),remark:remark.value.trim().slice(0,120),status:status.value});recordsState.transactions.unshift(t);writeJson(TRANSACTIONS_KEY,recordsState.transactions);closeToolModal();});
  });
}

function txnAccountName(t) { const a=recordsState.accounts.find(x=>x.id===t.accountId);return a?a.name:''; }
function statusLabel(s){return ({draft:'Draft',printed:'Printed',issued:'Issued',cleared:'Cleared',voided:'Voided'})[s]||s||'Issued';}

function buildTransactionTable(items, options={}) {
  const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');table.className='records-table';
  const thead=document.createElement('thead'), trh=document.createElement('tr');['Date','Cheque No.','Payee','Amount','Account','Status','Actions'].forEach(h=>{const th=document.createElement('th');th.textContent=h;trh.appendChild(th);});thead.appendChild(trh);table.appendChild(thead);
  const tb=document.createElement('tbody');
  items.forEach(t=>{const tr=document.createElement('tr');const vals=[t.date||'',t.chequeNo||'',t.payee||'',formatMoney(Number(t.amount||0)),txnAccountName(t),statusLabel(t.status)];vals.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===3)td.className='num';tr.appendChild(td);});const td=document.createElement('td');td.className='table-actions';const use=document.createElement('button');use.className='button ghost mini';use.textContent='Load';use.addEventListener('click',()=>loadTransactionIntoWriter(t));td.appendChild(use);if(options.reconcile){const clear=document.createElement('button');clear.className='button ghost mini';clear.textContent=t.status==='cleared'?'Mark Issued':'Mark Cleared';clear.addEventListener('click',()=>{t.status=t.status==='cleared'?'issued':'cleared';writeJson(TRANSACTIONS_KEY,recordsState.transactions);options.refresh&&options.refresh();});td.appendChild(clear);}const voidBtn=document.createElement('button');voidBtn.className='button danger mini';voidBtn.textContent=t.status==='voided'?'Unvoid':'Void';voidBtn.addEventListener('click',()=>{t.status=t.status==='voided'?'issued':'voided';writeJson(TRANSACTIONS_KEY,recordsState.transactions);options.refresh&&options.refresh();});td.appendChild(voidBtn);tr.appendChild(td);tb.appendChild(tr);});
  table.appendChild(tb);wrap.appendChild(table);return wrap;
}

function loadTransactionIntoWriter(t) {
  if (t.date) els.dateInput.value=t.date;if(typeof t.payee==='string')els.payeeInput.value=t.payee;els.amountInput.value=formatMoney(Number(t.amount||0));if(t.crossing)els.crossingSelect.value=t.crossing;if(templateById.has(t.templateId)){els.templateSelect.value=t.templateId;settings.selectedTemplateId=t.templateId;}
  recordsState.selectedAccountId=t.accountId||'';localStorage.setItem(SELECTED_ACCOUNT_KEY,recordsState.selectedAccountId);refreshAccountSelect();saveSettings();render();closeToolModal();
}

function openTransactionHistory() {
  openToolModal('Cheque Transaction History', body => {
    const search=textInput('',120,'Search payee, cheque no., remark or account');body.appendChild(field('Search',search));const region=document.createElement('div');body.appendChild(region);
    const refresh=()=>{const q=search.value.trim().toLowerCase();const items=recordsState.transactions.filter(t=>!q||[t.payee,t.chequeNo,t.remark,txnAccountName(t),t.status].some(v=>String(v||'').toLowerCase().includes(q)));region.textContent='';region.appendChild(buildTransactionTable(items,{refresh}));};search.addEventListener('input',refresh);refresh();
  });
}

function openReconciliation() {
  openToolModal('Cash Flow / Bank Reconciliation', body => {
    const info=document.createElement('div');info.className='info-box';info.textContent='Mark issued/printed cheques as Cleared when they reconcile with the bank. Voided records are retained in history.';body.appendChild(info);const region=document.createElement('div');body.appendChild(region);const refresh=()=>{region.textContent='';const items=recordsState.transactions.filter(t=>t.status!=='draft');region.appendChild(buildTransactionTable(items,{reconcile:true,refresh}));};refresh();
  });
}

function cashMetrics(items) {
  const sum=s=>items.filter(t=>t.status===s).reduce((a,t)=>a+Number(t.amount||0),0);
  return {issued:sum('issued')+sum('printed'),cleared:sum('cleared'),voided:sum('voided'),count:items.length};
}

function openCashFlow() {
  openToolModal('Monitor Cash Flow', body => {
    const m=cashMetrics(recordsState.transactions);const cards=document.createElement('div');cards.className='metric-grid';[['Outstanding / Issued',m.issued],['Cleared',m.cleared],['Voided',m.voided],['Saved Records',m.count]].forEach(([label,val],i)=>{const c=document.createElement('div');c.className='metric-card';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=i===3?String(val):formatMoney(val);c.append(l,v);cards.appendChild(c);});body.appendChild(cards);const recent=recordsState.transactions.filter(t=>t.status!=='voided').slice(0,50);body.appendChild(buildTransactionTable(recent));
  });
}

function openTransactionReport() {
  openToolModal('Cheque Transaction Report', body => {
    const grid=document.createElement('div');grid.className='tool-grid';const from=document.createElement('input');from.type='date';const to=document.createElement('input');to.type='date';const query=textInput('',120,'Payee / cheque no. / account');const status=selectInput([['','All statuses'],['draft','Draft'],['printed','Printed'],['issued','Issued'],['cleared','Cleared'],['voided','Voided']],'');grid.append(field('From',from),field('To',to),field('Search',query),field('Status',status));body.appendChild(grid);const region=document.createElement('div');body.appendChild(region);
    const filtered=()=>recordsState.transactions.filter(t=>(!from.value||t.date>=from.value)&&(!to.value||t.date<=to.value)&&(!status.value||t.status===status.value)&&(!query.value.trim()||[t.payee,t.chequeNo,txnAccountName(t)].some(v=>String(v||'').toLowerCase().includes(query.value.trim().toLowerCase()))));
    const refresh=()=>{region.textContent='';region.appendChild(buildTransactionTable(filtered()));};[from,to,query,status].forEach(el=>el.addEventListener('input',refresh));refresh();
    const exportBtn=document.createElement('button');exportBtn.className='button ghost';exportBtn.textContent='Export Filtered CSV';exportBtn.addEventListener('click',()=>downloadTransactionsCsv(filtered(),'cheque-report.csv'));body.appendChild(exportBtn);
  });
}

function openBatchPrint() {
  openToolModal('Batch Printing', body => {
    const info=document.createElement('div');info.className='info-box';info.textContent='For reliable browser batch printing, select records that use the same cheque template/page size. The app will build one print page per saved cheque.';body.appendChild(info);
    const form=document.createElement('div');form.className='batch-list';const eligible=recordsState.transactions.filter(t=>t.status!=='voided');eligible.forEach(t=>{const label=document.createElement('label');label.className='batch-row';const cb=document.createElement('input');cb.type='checkbox';cb.value=t.id;const text=document.createElement('span');text.textContent=`${t.date} • ${t.payee} • ${formatMoney(Number(t.amount||0))} • ${(templateById.get(t.templateId)||{}).label||t.templateId}`;label.append(cb,text);form.appendChild(label);});body.appendChild(form);const print=document.createElement('button');print.className='button primary';print.textContent='Print Selected';print.addEventListener('click',()=>{const ids=[...form.querySelectorAll('input:checked')].map(x=>x.value);if(!ids.length){alert('Select at least one cheque.');return;}printBatchTransactions(ids);});body.appendChild(print);
  });
}

function inputStateSnapshot(){return{date:els.dateInput.value,payee:els.payeeInput.value,amount:els.amountInput.value,crossing:els.crossingSelect.value,templateId:currentTemplateId(),accountId:recordsState.selectedAccountId,guides:showGuidesTransient};}
function restoreInputState(st){els.dateInput.value=st.date;els.payeeInput.value=st.payee;els.amountInput.value=st.amount;els.crossingSelect.value=st.crossing;els.templateSelect.value=st.templateId;recordsState.selectedAccountId=st.accountId||'';localStorage.setItem(SELECTED_ACCOUNT_KEY,recordsState.selectedAccountId);refreshAccountSelect();showGuidesTransient=st.guides;render();}

function printBatchTransactions(ids) {
  const txns=ids.map(id=>recordsState.transactions.find(t=>t.id===id)).filter(Boolean);if(!txns.length)return;const templateIds=[...new Set(txns.map(t=>t.templateId))];if(templateIds.length!==1){alert('Batch printing currently requires all selected cheques to use the same template/page size.');return;}
  const saved=inputStateSnapshot();const root=$('batchPrintRoot');root.textContent='';showGuidesTransient=false;
  txns.forEach(t=>{loadTransactionIntoWriterNoModal(t);render();const clone=els.sheet.cloneNode(true);clone.removeAttribute('id');clone.classList.add('batch-sheet');clone.style.transform='none';clone.querySelectorAll('.screen-only').forEach(x=>x.remove());root.appendChild(clone);});
  document.body.classList.add('batch-printing');root.setAttribute('aria-hidden','false');closeToolModal();
  const cleanup=()=>{document.body.classList.remove('batch-printing');root.textContent='';root.setAttribute('aria-hidden','true');restoreInputState(saved);window.removeEventListener('afterprint',cleanup);};window.addEventListener('afterprint',cleanup);setTimeout(()=>window.print(),80);
}

function loadTransactionIntoWriterNoModal(t){if(t.date)els.dateInput.value=t.date;els.payeeInput.value=t.payee||'';els.amountInput.value=formatMoney(Number(t.amount||0));els.crossingSelect.value=t.crossing||'ac-bearer';if(templateById.has(t.templateId))els.templateSelect.value=t.templateId;recordsState.selectedAccountId=t.accountId||'';refreshAccountSelect();}

function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function transactionCsv(items){const headers=['id','date','chequeNo','payee','amount','account','accountId','status','remark','crossing','templateId','createdAt'];return [headers.join(','),...items.map(t=>headers.map(h=>csvEscape(h==='account'?txnAccountName(t):t[h])).join(','))].join('\r\n');}
function downloadText(name,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadTransactionsCsv(items,name='cheque-transactions.csv'){downloadText(name,transactionCsv(items),'text/csv;charset=utf-8');}
function exportTransactionsCsv(){downloadTransactionsCsv(recordsState.transactions);}

function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')q=false;else field+=c;}else if(c==='"')q=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;}

async function importTransactionsCsvFile(e){const file=e.target.files&&e.target.files[0];e.target.value='';if(!file)return;const text=await file.text();const rows=parseCsv(text);if(rows.length<2){alert('No transaction rows found.');return;}const headers=rows[0].map(h=>h.trim());const idx=Object.fromEntries(headers.map((h,i)=>[h,i]));let count=0;for(const r of rows.slice(1)){if(!r.some(Boolean))continue;const amt=parseMoney(r[idx.amount]||'0');const rec={id:newId('txn'),date:(r[idx.date]||'').slice(0,10),chequeNo:(r[idx.chequeNo]||'').slice(0,40),payee:(r[idx.payee]||'').slice(0,120),amount:Number.isFinite(amt)?amt:0,accountId:(r[idx.accountId]||''),status:['draft','printed','issued','cleared','voided'].includes(r[idx.status])?r[idx.status]:'issued',remark:(r[idx.remark]||'').slice(0,120),crossing:(r[idx.crossing]||'ac-bearer'),templateId:templateById.has(r[idx.templateId])?r[idx.templateId]:currentTemplateId(),createdAt:new Date().toISOString()};recordsState.transactions.push(rec);count++;}writeJson(TRANSACTIONS_KEY,recordsState.transactions);alert(`Imported ${count} cheque transaction${count===1?'':'s'}.`);}

function openDataBackup(){openToolModal('Data File / Backup',body=>{const info=document.createElement('div');info.className='info-box';info.textContent='Pure flat-file web apps do not have a normal Windows data-file path. Accounts, payees and cheque history are stored in this browser’s local storage. Use backup/restore below to move or protect the local data.';body.appendChild(info);const stats=document.createElement('div');stats.className='metric-grid';[['Accounts',recordsState.accounts.length],['Payees',recordsState.payees.length],['Transactions',recordsState.transactions.length]].forEach(([l,v])=>{const c=document.createElement('div');c.className='metric-card';const a=document.createElement('span');a.textContent=l;const b=document.createElement('strong');b.textContent=String(v);c.append(a,b);stats.appendChild(c);});body.appendChild(stats);const actions=document.createElement('div');actions.className='tool-inline';const backup=document.createElement('button');backup.className='button primary';backup.textContent='Download JSON Backup';backup.addEventListener('click',downloadBackup);const restore=document.createElement('button');restore.className='button ghost';restore.textContent='Restore JSON Backup';restore.addEventListener('click',()=>$('backupImportInput').click());actions.append(backup,restore);body.appendChild(actions);});}
function downloadBackup(){const payload={version:1,exportedAt:new Date().toISOString(),accounts:recordsState.accounts,payees:recordsState.payees,transactions:recordsState.transactions};downloadText(`cheque-writer-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2),'application/json');}
async function importBackupFile(e){const file=e.target.files&&e.target.files[0];e.target.value='';if(!file)return;try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.accounts)||!Array.isArray(data.payees)||!Array.isArray(data.transactions))throw new Error('Invalid backup format');if(!confirm('Restore this backup and replace the current local accounts, payees and transaction history?'))return;recordsState.accounts=data.accounts.slice(0,500);recordsState.payees=data.payees.slice(0,5000);recordsState.transactions=data.transactions.slice(0,50000);writeJson(ACCOUNTS_KEY,recordsState.accounts);writeJson(PAYEES_KEY,recordsState.payees);writeJson(TRANSACTIONS_KEY,recordsState.transactions);recordsState.selectedAccountId='';localStorage.removeItem(SELECTED_ACCOUNT_KEY);refreshAccountSelect();closeToolModal();alert('Backup restored.');}catch(err){alert(`Could not restore backup: ${err.message}`);}}

function openNetworkShareInfo(){openToolModal('Share Data on Network',body=>{const info=document.createElement('div');info.className='info-box warning-box';info.textContent='Not enabled in this flat Vercel build. Browser local storage is isolated per browser/device. True multi-PC sharing requires a backend database or a LAN/local server with authentication and access controls.';body.appendChild(info);const p=document.createElement('p');p.className='tool-copy';p.textContent='The current build keeps financial records local by default. If network sharing is added later, it should use authenticated users, role permissions, audit logs and server-side validation rather than exposing a shared JSON file.';body.appendChild(p);});}

init().catch(err => {
  console.error(err);
  document.body.textContent = `Cheque Writer failed to start: ${err.message}`;
});
