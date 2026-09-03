'use strict';

const PX_PER_MM = 96 / 25.4;
const SETTINGS_KEY = 'cw.settings.v1';
const LAST_INPUT_KEY = 'cw.lastInput.v1';

const $ = (id) => document.getElementById(id);
const els = {};
let templates = [];
let templateById = new Map();
let settings = null;
let showGuidesTransient = null;
let resizeTimer = null;

const defaultSettings = () => ({
  orientation: 'template',
  feed: 'default',
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
    return {
      ...defaultSettings(),
      ...parsed,
      templateOffsets: parsed && parsed.templateOffsets && typeof parsed.templateOffsets === 'object' ? parsed.templateOffsets : {}
    };
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
    'orientationSetting','feedSetting','xDirection','xPixels','yDirection','yPixels','shiftAcPayee',
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
  return {x:Number(o.x)||0,y:Number(o.y)||0};
}

function actualPage(template) {
  let width = Number(template.page.widthMm);
  let height = Number(template.page.heightMm);
  if (settings.orientation === 'portrait' && width > height) [width,height] = [height,width];
  if (settings.orientation === 'landscape' && height > width) [width,height] = [height,width];
  return {width,height};
}

function setDynamicPageStyle(width, height) {
  let style = $('dynamicPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dynamicPageStyle';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
}

function render() {
  const template = currentTemplate();
  if (!template) return;
  settings.selectedTemplateId = template.id;

  const page = actualPage(template);
  els.sheet.style.width = `${page.width}mm`;
  els.sheet.style.height = `${page.height}mm`;
  els.printLayer.textContent = '';
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
      const vx = Number(e.widthMm || 0), vy = Number(e.heightMm || 0);
      const length = Math.hypot(vx, vy);
      const angle = Math.atan2(vy, vx) * 180 / Math.PI;
      line.style.left = `${Number(e.leftMm) + dx}mm`;
      line.style.top = `${Number(e.topMm) + dy}mm`;
      line.style.width = `${length}mm`;
      line.style.transform = `rotate(${angle}deg)`;
      els.printLayer.appendChild(line);
      continue;
    }

    const text = values[e.name] ?? '';
    if (!text) continue;
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
  els.offsetReadout.textContent = `Global ${globalOffset.x.toFixed(2)}, ${globalOffset.y.toFixed(2)} mm • Template ${templateOffset.x.toFixed(2)}, ${templateOffset.y.toFixed(2)} mm • Final ${finalX.toFixed(2)}, ${finalY.toFixed(2)} mm`;
  els.wordingPreview.textContent = amountWords || 'Enter an amount to generate cheque wording.';
  els.wordingLocale.textContent = `English • ${settings.andStyle === 'uk' ? 'UK' : 'US'} style`;
  scalePreview();
}

function shouldRenderElement(e, values) {
  if (e.name === 'mmPayeeOnly') return values.__crossLines && values.__acPayee;
  if (e.name === 'mmNoBearer') return e.visible && values.__noBearer;
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
    __noBearer: crossing === 'ac-nobearer',
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

init().catch(err => {
  console.error(err);
  document.body.textContent = `Cheque Writer failed to start: ${err.message}`;
});
