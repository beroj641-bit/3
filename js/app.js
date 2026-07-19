/**
 * Общая логика Telegram Mini App:
 * - получает подписанные данные пользователя Telegram;
 * - узнаёт статус заявки в Google Таблице;
 * - открывает страницу нужного статуса;
 * - отправляет новую анкету;
 * - корректно открывает ссылки t.me внутри Telegram.
 */

const APP_VERSION = '20260719-4';
const BASE_API_URL =
  window.__ENV && window.__ENV.API_BASE ? window.__ENV.API_BASE : '/api/gas';

const diagnosticEntries = [];

function redactDiagnosticValue(key, value) {
  if (/^(init_?data|bot_?token|hash|authorization)$/i.test(String(key))) {
    const length = typeof value === 'string' ? value.length : 0;
    return value ? `[скрыто, ${length} симв.]` : '[нет]';
  }

  if (typeof value === 'string') {
    return value
      .replace(/(init_?data=)[^&\s]+/gi, '$1[скрыто]')
      .replace(/(hash=)[a-f0-9]+/gi, '$1[скрыто]')
      .slice(0, 1800);
  }

  return value;
}

function diagnosticJson(data) {
  if (data === undefined) return '';

  try {
    return JSON.stringify(data, redactDiagnosticValue);
  } catch (_) {
    return String(data);
  }
}

function renderDiagnosticLog() {
  const output = document.getElementById('diagnosticOutput');
  if (!output) return;
  output.textContent = diagnosticEntries.join('\n');
  output.scrollTop = output.scrollHeight;
}

function addDiagnostic(event, data, level = 'INFO') {
  const time = new Date().toISOString();
  const details = diagnosticJson(data);
  const line = `[${time}] [${level}] ${event}${details ? ` ${details}` : ''}`;
  diagnosticEntries.push(line);
  if (diagnosticEntries.length > 120) diagnosticEntries.shift();
  renderDiagnosticLog();

  const method = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
  console[method](`[Realm diagnostic] ${event}`, data === undefined ? '' : data);
}

function getDiagnosticText() {
  return [
    'RealmSMP Mini App — диагностика',
    `Версия: ${APP_VERSION}`,
    `Страница: ${window.location.origin}${window.location.pathname}`,
    `User-Agent: ${navigator.userAgent}`,
    '',
    ...diagnosticEntries,
  ].join('\n');
}

function openDiagnosticPanel() {
  const panel = document.getElementById('diagnosticPanel');
  if (panel) panel.open = true;
}

async function copyDiagnosticLog() {
  const text = getDiagnosticText();
  const status = document.getElementById('diagnosticCopyStatus');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('clipboard_copy_failed');
    }

    if (status) status.textContent = 'Лог скопирован — пришли его в чат.';
  } catch (err) {
    if (status) status.textContent = 'Не удалось скопировать. Выдели текст лога вручную.';
    addDiagnostic('diagnostic_copy_failed', { message: err && err.message }, 'WARN');
  }
}

function safeDiagnosticUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const action = url.searchParams.get('action');
    url.search = action ? `?action=${encodeURIComponent(action)}` : '';
    return url.href;
  } catch (_) {
    return String(rawUrl || '').split('?')[0];
  }
}

function setupDiagnostics() {
  const copyButton = document.getElementById('copyDiagnosticLog');
  if (copyButton) copyButton.addEventListener('click', copyDiagnosticLog);

  window.addEventListener('error', (event) => {
    addDiagnostic('window_error', {
      message: event.message,
      file: event.filename ? event.filename.split('/').pop() : '',
      line: event.lineno,
    }, 'ERROR');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    addDiagnostic('unhandled_rejection', {
      name: reason && reason.name,
      message: reason && reason.message ? reason.message : String(reason),
    }, 'ERROR');
  });

  addDiagnostic('app_started', {
    version: APP_VERSION,
    page: getCurrentPage(),
    api: safeDiagnosticUrl(BASE_API_URL),
    online: navigator.onLine,
  });
}

const STATUS_PAGES = {
  blank: 'blank.html',
  pending: 'pending.html',
  accepted: 'accepted.html',
  rejected: 'rejected.html',
  banned: 'banned.html',
};

function getTelegram() {
  return window.Telegram && window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;
}

function getTelegramUser(tg) {
  return tg && tg.initDataUnsafe && tg.initDataUnsafe.user
    ? tg.initDataUnsafe.user
    : null;
}

function getCurrentPage() {
  const file = window.location.pathname.split('/').pop() || 'index.html';
  return file.replace(/\.html$/i, '') || 'index';
}

function getAppBasePath() {
  const path = window.location.pathname;
  const pagesIndex = path.lastIndexOf('/pages/');

  if (pagesIndex >= 0) {
    return path.slice(0, pagesIndex + 1);
  }

  if (path.endsWith('/')) return path;
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function redirectToStatus(status) {
  const targetFile = STATUS_PAGES[status];
  if (!targetFile) return false;

  const targetPath = `${getAppBasePath()}pages/${targetFile}`;
  const targetUrl = new URL(targetPath, window.location.origin);

  if (window.location.pathname !== targetUrl.pathname) {
    window.location.replace(targetUrl.href);
    return true;
  }

  return false;
}

function showAppMessage(text, variant = 'error') {
  const message = document.getElementById('formMessage') ||
    document.getElementById('appMessage');

  if (message) {
    message.hidden = !text;
    message.textContent = text || '';
    message.classList.remove('error', 'success');
    if (variant === 'error') message.classList.add('error');
    if (variant === 'success') message.classList.add('success');
    return;
  }

  const tg = getTelegram();
  if (text && tg && typeof tg.showAlert === 'function') {
    tg.showAlert(text);
    return;
  }

  if (text) window.alert(text);
}

function createApiUrl(action) {
  const url = new URL(BASE_API_URL, window.location.origin);
  url.searchParams.set('action', action);
  return url;
}

async function parseApiResponse(res, errorCode, requestName) {
  const responseText = await res.text();
  let json;

  addDiagnostic(`${requestName}_response`, {
    http_status: res.status,
    http_ok: res.ok,
    url: safeDiagnosticUrl(res.url),
    content_type: res.headers.get('content-type') || '',
    proxy: res.headers.get('x-realm-proxy') || '',
    upstream_status: res.headers.get('x-realm-upstream-status') || '',
    body: responseText || '[пустой ответ]',
  }, res.ok ? 'INFO' : 'ERROR');

  try {
    json = JSON.parse(responseText);
  } catch (_) {
    console.error('API returned invalid JSON:', res.status, responseText);
    const error = new Error(errorCode);
    error.diagnosticCode = `${requestName}_invalid_json`;
    throw error;
  }

  if (!res.ok || json.status !== 'ok') {
    console.error('API request failed:', res.status, json);
    const error = new Error(json.error || errorCode);
    error.diagnosticCode = json.error || errorCode;
    error.diagnosticDetails = json.diagnostic || json.detail || '';
    throw error;
  }

  return json;
}

async function fetchStatus(telegramId, initData) {
  const url = createApiUrl('status');
  url.searchParams.set('telegram_id', String(telegramId));
  url.searchParams.set('init_data', initData);
  url.searchParams.set('t', String(Date.now()));

  addDiagnostic('status_request', {
    url: safeDiagnosticUrl(url.href),
    telegram_id_suffix: String(telegramId).slice(-4),
    init_data_length: String(initData || '').length,
  });

  let res;
  try {
    res = await fetch(url.href, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch (err) {
    addDiagnostic('status_network_error', {
      name: err && err.name,
      message: err && err.message,
      online: navigator.onLine,
    }, 'ERROR');
    throw err;
  }

  const json = await parseApiResponse(res, 'status_fetch_failed', 'status');
  return json.data.status;
}

async function submitApplication(data) {
  const url = createApiUrl('submit');
  addDiagnostic('submit_request', {
    request_id: data.request_id,
    url: safeDiagnosticUrl(url.href),
    init_data_length: String(data.init_data || '').length,
    field_lengths: {
      display_name: String(data.display_name || '').length,
      age: String(data.age || '').length,
      about: String(data.about || '').length,
      mc_nick: String(data.mc_nick || '').length,
      bot_comment: String(data.bot_comment || '').length,
    },
    play_modes: {
      chat_only: data.play_chat_only === true,
      webcam: data.play_with_webcam === true,
      voice: data.play_with_voice === true,
    },
  });

  let res;
  try {
    res = await fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
      cache: 'no-store',
    });
  } catch (err) {
    addDiagnostic('submit_network_error', {
      request_id: data.request_id,
      name: err && err.name,
      message: err && err.message,
      online: navigator.onLine,
    }, 'ERROR');
    throw err;
  }

  const json = await parseApiResponse(res, 'submit_failed', 'submit');
  addDiagnostic('submit_success', {
    request_id: data.request_id,
    status: json.data && json.data.status,
    diagnostic: json.diagnostic || '',
  });
  return json.data.status;
}

function bindTelegramLinks(tg) {
  document.querySelectorAll('a[href]').forEach((link) => {
    const rawHref = link.getAttribute('href');
    if (!rawHref) return;

    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch (_) {
      return;
    }

    const isTelegramLink =
      url.hostname === 't.me' || url.hostname === 'telegram.me';

    if (!isTelegramLink) return;

    link.addEventListener('click', (event) => {
      if (!tg || typeof tg.openTelegramLink !== 'function') return;

      event.preventDefault();
      url.protocol = 'https:';
      tg.openTelegramLink(url.href);
    });
  });
}

function collectFormData() {
  const formData = {};

  document.querySelectorAll('input[name], textarea[name]').forEach((el) => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      formData[el.name] = el.checked;
      return;
    }

    formData[el.name] = (el.dataset.submitValue || el.value).trim();
  });

  return formData;
}

function validateForm(data) {
  if (!data.display_name || !data.age || !data.about || !data.mc_nick) {
    return 'Заполни все обязательные поля.';
  }

  if (!/^\d{1,2}$/.test(data.age)) {
    return 'Возраст должен состоять из одной или двух цифр.';
  }

  if (data.age === '67' || data.age === '69') {
    return 'Укажи другой возраст.';
  }

  if (!data.play_with_webcam && !data.play_with_voice && !data.play_chat_only) {
    return 'Выбери хотя бы один вариант: вебка, войс или только чат.';
  }

  return '';
}

function bindApplicationForm(tg, user) {
  const submitBtn = document.querySelector('[data-submit-application]');
  if (!submitBtn) return;

  submitBtn.addEventListener('click', async () => {
    if (submitBtn.dataset.submitting === 'true') return;

    const formData = collectFormData();
    const validationError = validateForm(formData);
    if (validationError) {
      addDiagnostic('submit_validation_failed', { reason: validationError }, 'WARN');
      showAppMessage(validationError);
      return;
    }

    submitBtn.dataset.submitting = 'true';
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Отправляем…';
    showAppMessage('');

    try {
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        request_id: requestId,
        init_data: tg.initData,
        telegram_id: user.id,
        telegram_username: user.username || '',
        telegram_first_name: user.first_name || '',
        ...formData,
      };

      const status = await submitApplication(payload);
      redirectToStatus(status);
    } catch (err) {
      console.error('Application submit failed:', err);
      addDiagnostic('submit_failed', {
        code: err && (err.diagnosticCode || err.message),
        message: err && err.message,
        details: err && err.diagnosticDetails,
      }, 'ERROR');
      openDiagnosticPanel();
      showAppMessage(
        `Не удалось отправить заявку. Код: ${
          (err && (err.diagnosticCode || err.message)) || 'unknown_error'
        }. Скопируй лог из блока «Диагностика отправки».`
      );
      submitBtn.disabled = false;
      submitBtn.setAttribute('aria-disabled', 'false');
      submitBtn.textContent = originalText;
      delete submitBtn.dataset.submitting;
    }
  });
}

async function initApp() {
  const tg = getTelegram();

  if (tg) {
    try {
      tg.ready();
      tg.expand();
    } catch (err) {
      console.warn('Telegram WebApp initialization failed:', err);
    }
  }

  bindTelegramLinks(tg);

  const user = getTelegramUser(tg);
  const currentPage = getCurrentPage();

  addDiagnostic('telegram_context', {
    sdk_loaded: Boolean(tg),
    init_data_present: Boolean(tg && tg.initData),
    init_data_length: tg && tg.initData ? tg.initData.length : 0,
    user_present: Boolean(user && user.id),
    telegram_id_suffix: user && user.id ? String(user.id).slice(-4) : '',
    platform: tg && tg.platform ? tg.platform : '',
    version: tg && tg.version ? tg.version : '',
  });

  if (!tg || !tg.initData || !user || !user.id) {
    addDiagnostic('telegram_context_missing', {
      sdk_loaded: Boolean(tg),
      init_data_present: Boolean(tg && tg.initData),
      user_present: Boolean(user && user.id),
    }, 'ERROR');
    if (currentPage === 'index') redirectToStatus('blank');
    if (currentPage === 'blank') {
      showAppMessage(
        'Telegram не передал данные для отправки. Открой анкету кнопкой Mini App внутри бота и скопируй диагностический лог.'
      );
      openDiagnosticPanel();
    }
    return;
  }

  try {
    const status = await fetchStatus(user.id, tg.initData);
    if (redirectToStatus(status)) return;
  } catch (err) {
    console.error('Status check failed:', err);
    addDiagnostic('status_failed', {
      code: err && (err.diagnosticCode || err.message),
      message: err && err.message,
      details: err && err.diagnosticDetails,
    }, 'ERROR');

    if (currentPage === 'index') {
      showAppMessage(
        'Не удалось получить статус заявки. Проверь подключение Google Таблицы.'
      );
      return;
    }
  }

  if (currentPage === 'blank') {
    bindApplicationForm(tg, user);
  }
}

document.addEventListener('DOMContentLoaded', setupDiagnostics);
document.addEventListener('DOMContentLoaded', initApp);
