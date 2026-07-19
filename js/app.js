/**
 * Общая логика Telegram Mini App:
 * - получает подписанные данные пользователя Telegram;
 * - узнаёт статус заявки в Google Таблице;
 * - открывает страницу нужного статуса;
 * - отправляет новую анкету;
 * - корректно открывает ссылки t.me внутри Telegram.
 */

const BASE_API_URL =
  window.__ENV && window.__ENV.API_BASE ? window.__ENV.API_BASE : '/api/gas';

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

async function parseApiResponse(res, errorCode) {
  const responseText = await res.text();
  let json;

  try {
    json = JSON.parse(responseText);
  } catch (_) {
    console.error('API returned invalid JSON:', res.status, responseText);
    throw new Error(errorCode);
  }

  if (!res.ok || json.status !== 'ok') {
    console.error('API request failed:', res.status, json);
    throw new Error(json.error || errorCode);
  }

  return json;
}

async function fetchStatus(telegramId, initData) {
  const url = createApiUrl('status');
  url.searchParams.set('telegram_id', String(telegramId));
  url.searchParams.set('init_data', initData);
  url.searchParams.set('t', String(Date.now()));

  const res = await fetch(url.href, {
    method: 'GET',
    cache: 'no-store',
  });

  const json = await parseApiResponse(res, 'status_fetch_failed');
  return json.data.status;
}

async function submitApplication(data) {
  const url = createApiUrl('submit');
  const res = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
    cache: 'no-store',
  });

  const json = await parseApiResponse(res, 'submit_failed');
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
    formData[el.name] = el.type === 'checkbox'
      ? el.checked
      : (el.dataset.submitValue || el.value).trim();
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

  if (!data.play_with_webcam && !data.play_with_voice) {
    return 'Выбери хотя бы один вариант: вебка или войс.';
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
      const payload = {
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
      showAppMessage(
        'Не удалось отправить заявку. Проверь настройку Google Apps Script и попробуй ещё раз.'
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

  if (!tg || !tg.initData || !user || !user.id) {
    if (currentPage === 'index') redirectToStatus('blank');
    return;
  }

  try {
    const status = await fetchStatus(user.id, tg.initData);
    if (redirectToStatus(status)) return;
  } catch (err) {
    console.error('Status check failed:', err);

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

document.addEventListener('DOMContentLoaded', initApp);
