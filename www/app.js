/* ==========================================================================
   AI Chat — Client Side
   Semua data (API Key, Base URL, dan Histori Chat) disimpan HANYA di
   localStorage browser pengguna. Tidak ada server backend sama sekali.

   Fitur tambahan di file ini:
   - Tingkat "upaya berpikir" (Rendah/Sedang/Tinggi/Ekstra/Extreme) + mode
     Deep Thinking & Super Deep Thinking (extended thinking, khusus optimal
     di provider Anthropic/Claude; provider lain disimulasikan lewat prompt).
   - Toggle Pencarian Web (tool bawaan Anthropic `web_search`).
   - Lampiran File / Foto / Video lewat tombol "+", dengan pratinjau &
     modal viewer.
   - Konvensi "===FILE: nama===...===END FILE===" agar AI bisa membuatkan
     file yang otomatis dapat diunduh satu per satu atau digabung jadi ZIP.
   ========================================================================== */

const STORAGE_KEYS = {
  SETTINGS: 'aichat_settings_v1',
  CHATS: 'aichat_chats_v1',
  ACTIVE_CHAT: 'aichat_active_chat_v1',
};

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  custom: '',
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  groq: 'openai/gpt-oss-120b',
  custom: '',
};

const BASE_URL_HINTS = {
  openai: 'Endpoint standar OpenAI Chat Completions API.',
  anthropic: 'Endpoint Anthropic Messages API. Panggilan langsung dari browser memerlukan header khusus (sudah ditangani otomatis).',
  groq: 'Endpoint Groq yang kompatibel dengan format OpenAI.',
  custom: 'Masukkan base URL lengkap dari provider OpenAI-compatible pilihanmu.',
};

/* ---------------------------- Effort / thinking levels ---------------------------- */
// budget = token budget untuk extended thinking (Anthropic). maxTokens = batas output.
// reasoningEffort = dipetakan ke parameter `reasoning_effort` resmi OpenAI (model seri-o/gpt-5).
const EFFORT_LEVELS = {
  low:      { label: 'Rendah',              thinking: false, budget: 0,     maxTokens: 1024, reasoningEffort: 'low',    promptHint: '' },
  medium:   { label: 'Sedang',              thinking: false, budget: 0,     maxTokens: 2048, reasoningEffort: 'medium', promptHint: '' },
  high:     { label: 'Tinggi',              thinking: true,  budget: 2000,  maxTokens: 4096,  reasoningEffort: 'high', promptHint: 'Pikirkan jawabanmu dengan cermat sebelum menjawab.' },
  extra:    { label: 'Ekstra',              thinking: true,  budget: 6000,  maxTokens: 9000,  reasoningEffort: 'high', promptHint: 'Pikirkan secara ekstra teliti dan pertimbangkan beberapa sudut pandang sebelum menjawab.' },
  extreme:  { label: 'Extreme',             thinking: true,  budget: 12000, maxTokens: 16000, reasoningEffort: 'high', promptHint: 'Gunakan penalaran yang sangat mendalam dan menyeluruh, lalu periksa ulang logikamu sebelum menjawab.' },
  deep:     { label: 'Deep Thinking',       thinking: true,  budget: 20000, maxTokens: 26000, reasoningEffort: 'high', promptHint: 'Berpikirlah selangkah demi selangkah secara sangat mendalam, eksplorasi beberapa pendekatan berbeda, lalu verifikasi jawabanmu sebelum memberi jawaban akhir.' },
  superdeep:{ label: 'Super Deep Thinking',  thinking: true,  budget: 31000, maxTokens: 40000, reasoningEffort: 'high', promptHint: 'Gunakan penalaran paling mendalam dan menyeluruh yang kamu mampu: uraikan masalahnya, coba beberapa pendekatan berbeda, kritisi hasil sementaramu, lalu berikan jawaban akhir yang sudah diverifikasi berulang kali.' },
};

/* ---------------------------- File output convention ---------------------------- */

const FILE_BLOCK_RE = /===FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n===END FILE===/g;

const FILE_CONVENTION_NOTE = 'Jika kamu perlu membuatkan pengguna sebuah file (kode, teks, konfigurasi, atau apa pun) yang harus bisa diunduh langsung, bungkus SETIAP file dengan format persis berikut (baris penanda harus persis sama, nama file boleh menyertakan path folder):\n===FILE: nama_file_atau_path.ext===\n<isi lengkap file di sini>\n===END FILE===\nGunakan satu blok seperti ini untuk setiap file. Jika ada lebih dari satu file, aplikasi akan otomatis menawarkan tombol untuk mengunduh semuanya sekaligus sebagai satu file ZIP.';

/* ---------------------------- Attachment helpers ---------------------------- */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;       // 5MB per gambar
const MAX_TEXT_FILE_BYTES = 400 * 1024;        // 400KB per file teks yang dibaca
const MAX_TEXT_CHARS_FOR_API = 8000;           // dipotong saat dikirim ke API

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.html',
  '.htm', '.css', '.scss', '.xml', '.yml', '.yaml', '.sh', '.bash', '.sql', '.csv', '.log',
  '.ini', '.toml', '.gradle', '.kt', '.kts', '.swift', '.dart'];

function isTextFile(file) {
  if (file.type && file.type.startsWith('text/')) return true;
  if (file.type === 'application/json') return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/* ---------------------------- State ---------------------------- */

let settings = loadSettings();
let chats = loadChats();          // { [id]: { id, title, messages: [{role, content, attachments?, thinking?, effortLabel?}], createdAt } }
let activeChatId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAT) || null;
let isStreaming = false;
let pendingAttachments = [];       // lampiran yang sedang disiapkan untuk pesan berikutnya
let currentEffort = 'medium';
let webSearchEnabled = false;

/* ---------------------------- DOM refs ---------------------------- */

const $ = (sel) => document.querySelector(sel);

const el = {
  sidebar: $('#sidebar'),
  menuToggle: $('#menuToggle'),
  historyList: $('#historyList'),
  newChatBtn: $('#newChatBtn'),
  settingsBtn: $('#settingsBtn'),
  clearChatBtn: $('#clearChatBtn'),
  modelLabel: $('#modelLabel'),

  messages: $('#messages'),
  emptyState: $('#emptyState'),
  composerForm: $('#composerForm'),
  userInput: $('#userInput'),
  sendBtn: $('#sendBtn'),

  modeChips: $('#modeChips'),
  attachmentsPreview: $('#attachmentsPreview'),
  plusBtn: $('#plusBtn'),
  plusMenu: $('#plusMenu'),
  webSearchToggle: $('#webSearchToggle'),
  effortBtn: $('#effortBtn'),
  effortMenu: $('#effortMenu'),
  effortLabel: $('#effortLabel'),
  fileInputGeneric: $('#fileInputGeneric'),
  fileInputPhoto: $('#fileInputPhoto'),
  fileInputVideo: $('#fileInputVideo'),

  viewerOverlay: $('#viewerOverlay'),
  viewerTitle: $('#viewerTitle'),
  viewerBody: $('#viewerBody'),
  viewerDownloadBtn: $('#viewerDownloadBtn'),
  closeViewerBtn: $('#closeViewerBtn'),

  settingsOverlay: $('#settingsOverlay'),
  closeSettingsBtn: $('#closeSettingsBtn'),
  providerSelect: $('#providerSelect'),
  baseUrlInput: $('#baseUrlInput'),
  baseUrlHint: $('#baseUrlHint'),
  apiKeyInput: $('#apiKeyInput'),
  toggleKeyVisibility: $('#toggleKeyVisibility'),
  modelInput: $('#modelInput'),
  systemPromptInput: $('#systemPromptInput'),
  temperatureInput: $('#temperatureInput'),
  temperatureValue: $('#temperatureValue'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  clearAllDataBtn: $('#clearAllDataBtn'),

  toast: $('#toast'),
};

/* ---------------------------- Storage helpers ---------------------------- */

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt data */ }
  return {
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URLS.openai,
    apiKey: '',
    model: DEFAULT_MODELS.openai,
    systemPrompt: '',
    temperature: 0.7,
    defaultEffort: 'medium',
  };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHATS);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt data */ }
  return {};
}

function saveChats() {
  try {
    localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
  } catch (e) {
    showToast('Gagal menyimpan chat — kemungkinan penyimpanan lokal penuh (lampiran terlalu besar).');
  }
}

function setActiveChat(id) {
  activeChatId = id;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_CHAT, id || '');
}

/* ---------------------------- Toast ---------------------------- */

let toastTimer = null;
function showToast(msg, ms = 3200) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

/* ---------------------------- Settings modal ---------------------------- */

function openSettings() {
  el.providerSelect.value = settings.provider;
  el.baseUrlInput.value = settings.baseUrl;
  el.baseUrlHint.textContent = BASE_URL_HINTS[settings.provider] || '';
  el.apiKeyInput.value = settings.apiKey;
  el.apiKeyInput.type = 'password';
  el.modelInput.value = settings.model;
  el.systemPromptInput.value = settings.systemPrompt || '';
  el.temperatureInput.value = settings.temperature;
  el.temperatureValue.textContent = settings.temperature;
  el.settingsOverlay.classList.add('open');
}

function closeSettings() {
  el.settingsOverlay.classList.remove('open');
}

el.settingsBtn.addEventListener('click', openSettings);
el.closeSettingsBtn.addEventListener('click', closeSettings);
el.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === el.settingsOverlay) closeSettings();
});

el.providerSelect.addEventListener('change', () => {
  const p = el.providerSelect.value;
  el.baseUrlInput.value = DEFAULT_BASE_URLS[p];
  el.baseUrlHint.textContent = BASE_URL_HINTS[p] || '';
  if (!el.modelInput.value) el.modelInput.value = DEFAULT_MODELS[p];
});

el.toggleKeyVisibility.addEventListener('click', () => {
  el.apiKeyInput.type = el.apiKeyInput.type === 'password' ? 'text' : 'password';
});

el.temperatureInput.addEventListener('input', () => {
  el.temperatureValue.textContent = el.temperatureInput.value;
});

el.saveSettingsBtn.addEventListener('click', () => {
  settings = {
    ...settings,
    provider: el.providerSelect.value,
    baseUrl: el.baseUrlInput.value.trim().replace(/\/+$/, ''),
    apiKey: el.apiKeyInput.value.trim(),
    model: el.modelInput.value.trim() || DEFAULT_MODELS[el.providerSelect.value],
    systemPrompt: el.systemPromptInput.value,
    temperature: parseFloat(el.temperatureInput.value),
  };
  saveSettings();
  updateModelLabel();
  closeSettings();
  showToast('Pengaturan disimpan.');
});

el.clearAllDataBtn.addEventListener('click', () => {
  if (!confirm('Hapus semua data (API Key, pengaturan, dan seluruh histori chat)? Tindakan ini tidak bisa dibatalkan.')) return;
  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  localStorage.removeItem(STORAGE_KEYS.CHATS);
  localStorage.removeItem(STORAGE_KEYS.ACTIVE_CHAT);
  settings = loadSettings();
  chats = {};
  activeChatId = null;
  renderHistoryList();
  renderMessages();
  updateModelLabel();
  closeSettings();
  showToast('Semua data telah dihapus.');
});

function updateModelLabel() {
  if (!settings.apiKey) {
    el.modelLabel.textContent = 'Belum ada API Key — buka Pengaturan';
  } else {
    const providerName = { openai: 'OpenAI', anthropic: 'Claude', groq: 'Groq', custom: 'Custom' }[settings.provider] || settings.provider;
    el.modelLabel.textContent = `${providerName} · ${settings.model}`;
  }
}

/* ---------------------------- Sidebar / history ---------------------------- */

el.menuToggle.addEventListener('click', () => el.sidebar.classList.toggle('open'));

function createNewChat() {
  const id = 'chat_' + Date.now();
  chats[id] = { id, title: 'Chat baru', messages: [], createdAt: Date.now() };
  saveChats();
  setActiveChat(id);
  renderHistoryList();
  renderMessages();
  el.sidebar.classList.remove('open');
}

el.newChatBtn.addEventListener('click', createNewChat);

el.clearChatBtn.addEventListener('click', () => {
  if (!activeChatId || !chats[activeChatId]) return;
  if (!confirm('Hapus chat ini?')) return;
  delete chats[activeChatId];
  saveChats();
  const remaining = Object.keys(chats);
  setActiveChat(remaining.length ? remaining[remaining.length - 1] : null);
  renderHistoryList();
  renderMessages();
});

function renderHistoryList() {
  el.historyList.innerHTML = '';
  const sorted = Object.values(chats).sort((a, b) => b.createdAt - a.createdAt);
  for (const chat of sorted) {
    const item = document.createElement('div');
    item.className = 'history-item' + (chat.id === activeChatId ? ' active' : '');
    item.innerHTML = `<span class="title"></span><button class="del-btn" title="Hapus">✕</button>`;
    item.querySelector('.title').textContent = chat.title || 'Chat baru';
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del-btn')) return;
      setActiveChat(chat.id);
      renderHistoryList();
      renderMessages();
      el.sidebar.classList.remove('open');
    });
    item.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Hapus chat ini?')) return;
      delete chats[chat.id];
      saveChats();
      if (activeChatId === chat.id) {
        const remaining = Object.keys(chats);
        setActiveChat(remaining.length ? remaining[remaining.length - 1] : null);
      }
      renderHistoryList();
      renderMessages();
    });
    el.historyList.appendChild(item);
  }
}

/* ---------------------------- Popovers (plus menu & effort menu) ---------------------------- */

function closeAllPopovers() {
  el.plusMenu.classList.remove('open');
  el.effortMenu.classList.remove('open');
}

el.plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = !el.plusMenu.classList.contains('open');
  closeAllPopovers();
  if (willOpen) el.plusMenu.classList.add('open');
});

el.effortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = !el.effortMenu.classList.contains('open');
  closeAllPopovers();
  if (willOpen) el.effortMenu.classList.add('open');
});

document.addEventListener('click', (e) => {
  if (!el.plusMenu.contains(e.target) && e.target !== el.plusBtn &&
      !el.effortMenu.contains(e.target) && e.target !== el.effortBtn) {
    closeAllPopovers();
  }
});

el.plusMenu.querySelectorAll('[data-attach]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.attach;
    closeAllPopovers();
    if (kind === 'file') el.fileInputGeneric.click();
    else if (kind === 'photo') el.fileInputPhoto.click();
    else if (kind === 'video') el.fileInputVideo.click();
  });
});

el.effortMenu.querySelectorAll('[data-effort]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentEffort = btn.dataset.effort;
    settings.defaultEffort = currentEffort;
    saveSettings();
    updateEffortUI();
    closeAllPopovers();
  });
});

el.webSearchToggle.addEventListener('click', () => {
  webSearchEnabled = !webSearchEnabled;
  el.webSearchToggle.classList.toggle('active', webSearchEnabled);
  if (webSearchEnabled && settings.provider !== 'anthropic') {
    showToast('Pencarian web (tool bawaan) saat ini hanya benar-benar berjalan di provider Anthropic (Claude). Di provider lain, AI akan menjawab tanpa hasil pencarian nyata.');
  }
  renderModeChips();
});

function updateEffortUI() {
  const cfg = EFFORT_LEVELS[currentEffort];
  el.effortLabel.textContent = cfg.label;
  el.effortBtn.dataset.effort = currentEffort;
  el.effortMenu.querySelectorAll('[data-effort]').forEach((b) => {
    b.classList.toggle('active', b.dataset.effort === currentEffort);
  });
  renderModeChips();
}

function makeChip(label, onRemove) {
  const chip = document.createElement('div');
  chip.className = 'mode-chip';
  const span = document.createElement('span');
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '✕';
  btn.setAttribute('aria-label', 'Hapus');
  btn.addEventListener('click', onRemove);
  chip.appendChild(span);
  chip.appendChild(btn);
  return chip;
}

function renderModeChips() {
  el.modeChips.innerHTML = '';
  const cfg = EFFORT_LEVELS[currentEffort];
  if (currentEffort !== 'medium') {
    el.modeChips.appendChild(makeChip(`🧠 ${cfg.label}`, () => {
      currentEffort = 'medium';
      settings.defaultEffort = currentEffort;
      saveSettings();
      updateEffortUI();
    }));
  }
  if (webSearchEnabled) {
    el.modeChips.appendChild(makeChip('🔎 Pencarian Web', () => {
      webSearchEnabled = false;
      el.webSearchToggle.classList.remove('active');
      renderModeChips();
    }));
  }
  el.modeChips.classList.toggle('has-items', el.modeChips.children.length > 0);
}

/* ---------------------------- Attachments ---------------------------- */

async function addFilesToPending(fileList) {
  for (const file of Array.from(fileList || [])) {
    const id = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    try {
      if (file.type && file.type.startsWith('image/')) {
        if (file.size > MAX_IMAGE_BYTES) {
          showToast(`"${file.name}" terlalu besar (maksimal 5MB untuk gambar).`);
          continue;
        }
        const dataUrl = await readFileAsDataURL(file);
        pendingAttachments.push({ id, kind: 'image', name: file.name, mime: file.type, size: file.size, dataUrl });
      } else if (file.type && file.type.startsWith('video/')) {
        const blobUrl = URL.createObjectURL(file);
        pendingAttachments.push({ id, kind: 'video', name: file.name, mime: file.type, size: file.size, blobUrl, notSent: true });
        showToast(`Video "${file.name}" dilampirkan hanya untuk pratinjau — belum ada model AI yang bisa "menonton" video langsung lewat browser.`);
      } else if (isTextFile(file) && file.size <= MAX_TEXT_FILE_BYTES) {
        const text = await readFileAsText(file);
        pendingAttachments.push({ id, kind: 'file', name: file.name, mime: file.type || 'text/plain', size: file.size, textContent: text, isText: true });
      } else {
        const blobUrl = URL.createObjectURL(file);
        pendingAttachments.push({ id, kind: 'file', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, blobUrl, notSent: true, isText: false });
        showToast(`"${file.name}" dilampirkan sebagai referensi saja — isinya tidak dikirim ke AI.`);
      }
    } catch (err) {
      showToast(`Gagal membaca "${file.name}".`);
    }
  }
  renderAttachmentsPreview();
}

function handleFilesSelected(fileList) {
  addFilesToPending(fileList).then(() => {
    el.fileInputGeneric.value = '';
    el.fileInputPhoto.value = '';
    el.fileInputVideo.value = '';
  });
}

el.fileInputGeneric.addEventListener('change', (e) => handleFilesSelected(e.target.files));
el.fileInputPhoto.addEventListener('change', (e) => handleFilesSelected(e.target.files));
el.fileInputVideo.addEventListener('change', (e) => handleFilesSelected(e.target.files));

function buildAttachmentChip(att, { removable = false, onRemove = null } = {}) {
  const chip = document.createElement('div');
  chip.className = `att-chip att-${att.kind}`;

  if (att.kind === 'image' && att.dataUrl) {
    const img = document.createElement('img');
    img.src = att.dataUrl;
    chip.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'att-icon';
    icon.textContent = att.kind === 'video' ? '🎥' : (att.isText ? '📄' : '📎');
    chip.appendChild(icon);
  }

  const info = document.createElement('div');
  info.className = 'att-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'att-name';
  nameEl.textContent = att.name;
  const sizeEl = document.createElement('span');
  sizeEl.className = 'att-size';
  sizeEl.textContent = formatBytes(att.size || 0) + (att.notSent ? ' · tidak dikirim ke AI' : '');
  info.appendChild(nameEl);
  info.appendChild(sizeEl);
  chip.appendChild(info);

  if (removable) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'att-remove';
    rm.textContent = '✕';
    rm.setAttribute('aria-label', 'Hapus lampiran');
    rm.addEventListener('click', (e) => { e.stopPropagation(); onRemove && onRemove(); });
    chip.appendChild(rm);
  }

  chip.addEventListener('click', () => {
    if (att.kind === 'image' && att.dataUrl) {
      openViewer({ title: att.name, kind: 'image', src: att.dataUrl, downloadName: att.name });
    } else if (att.kind === 'video' && att.blobUrl) {
      openViewer({ title: att.name, kind: 'video', src: att.blobUrl, downloadName: att.name });
    } else if (att.isText && att.textContent) {
      openViewer({ title: att.name, kind: 'text', textContent: att.textContent, downloadName: att.name });
    } else if (att.blobUrl) {
      openViewer({ title: att.name, kind: 'binary', src: att.blobUrl, downloadName: att.name });
    } else {
      openViewer({ title: att.name, kind: 'binary' });
    }
  });

  return chip;
}

function renderAttachmentsPreview() {
  el.attachmentsPreview.innerHTML = '';
  el.attachmentsPreview.classList.toggle('has-items', pendingAttachments.length > 0);
  for (const att of pendingAttachments) {
    const chip = buildAttachmentChip(att, {
      removable: true,
      onRemove: () => {
        if (att.blobUrl) URL.revokeObjectURL(att.blobUrl);
        pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
        renderAttachmentsPreview();
      },
    });
    el.attachmentsPreview.appendChild(chip);
  }
}

/* ---------------------------- Viewer modal ---------------------------- */

function openViewer({ title, kind, src = null, textContent = null, downloadName = 'file' }) {
  el.viewerTitle.textContent = title || 'Pratinjau';
  el.viewerBody.innerHTML = '';

  if (kind === 'image' && src) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'viewer-image';
    el.viewerBody.appendChild(img);
  } else if (kind === 'video' && src) {
    const vid = document.createElement('video');
    vid.src = src;
    vid.controls = true;
    vid.className = 'viewer-video';
    el.viewerBody.appendChild(vid);
  } else if (kind === 'text' && textContent !== null) {
    const pre = document.createElement('pre');
    pre.className = 'viewer-text';
    pre.textContent = textContent;
    el.viewerBody.appendChild(pre);
  } else {
    const p = document.createElement('p');
    p.className = 'viewer-nopreview';
    p.textContent = src
      ? 'Tidak ada pratinjau untuk tipe file ini, tapi kamu tetap bisa mengunduhnya.'
      : 'Tidak ada pratinjau tersedia (mungkin karena aplikasi baru saja dimuat ulang).';
    el.viewerBody.appendChild(p);
  }

  el.viewerDownloadBtn.onclick = () => {
    if (kind === 'text' && textContent !== null) {
      const blob = new Blob([textContent], { type: 'text/plain' });
      downloadBlob(blob, downloadName);
    } else if (src) {
      const a = document.createElement('a');
      a.href = src;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      showToast('Tidak ada file untuk diunduh.');
    }
  };

  el.viewerOverlay.classList.add('open');
}

el.closeViewerBtn.addEventListener('click', () => el.viewerOverlay.classList.remove('open'));
el.viewerOverlay.addEventListener('click', (e) => {
  if (e.target === el.viewerOverlay) el.viewerOverlay.classList.remove('open');
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------------------- File-block parsing (===FILE:===) ---------------------------- */

function parseFileBlocks(text) {
  const files = [];
  const cleaned = text.replace(FILE_BLOCK_RE, (match, name, content) => {
    files.push({ name: name.trim(), content });
    return '';
  });
  return { cleaned: cleaned.trim(), files };
}

function buildFileCard(f) {
  const card = document.createElement('div');
  card.className = 'file-card';

  const header = document.createElement('div');
  header.className = 'file-card-header';
  const nameEl = document.createElement('span');
  nameEl.className = 'file-card-name';
  nameEl.textContent = '📄 ' + f.name;
  header.appendChild(nameEl);

  const actions = document.createElement('div');
  actions.className = 'file-card-actions';

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.textContent = 'Lihat';
  viewBtn.addEventListener('click', () => openViewer({ title: f.name, kind: 'text', textContent: f.content, downloadName: f.name }));

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.textContent = 'Unduh';
  dlBtn.addEventListener('click', () => {
    const blob = new Blob([f.content], { type: 'text/plain' });
    downloadBlob(blob, f.name);
  });

  actions.appendChild(viewBtn);
  actions.appendChild(dlBtn);
  header.appendChild(actions);

  const pre = document.createElement('pre');
  pre.className = 'file-card-preview';
  pre.textContent = f.content.length > 500 ? f.content.slice(0, 500) + '\n…' : f.content;

  card.appendChild(header);
  card.appendChild(pre);
  return card;
}

async function downloadFilesAsZip(files) {
  if (!window.JSZip) {
    showToast('JSZip belum berhasil dimuat (butuh koneksi internet). Coba unduh file satu per satu.');
    return;
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.content);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `ai-chat-files-${Date.now()}.zip`);
}

/* ---------------------------- Message rendering ---------------------------- */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Very small, safe markdown-ish formatter: code blocks, inline code, line breaks.
function formatContent(text) {
  const escaped = escapeHtml(text);
  const withCodeBlocks = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  const withInlineCode = withCodeBlocks.replace(/`([^`]+)`/g, '<code>$1</code>');
  const withParagraphs = withInlineCode
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return withParagraphs;
}

function renderMessages() {
  el.messages.innerHTML = '';
  const chat = activeChatId ? chats[activeChatId] : null;

  if (!chat || chat.messages.length === 0) {
    el.messages.appendChild(el.emptyState);
    return;
  }

  for (const msg of chat.messages) {
    el.messages.appendChild(buildMessageNode(msg));
  }
  scrollToBottom();
}

function buildMessageNode(msg, isTyping = false) {
  const { role, content = '', attachments = [], thinking = null, effortLabel = null, isError = false } = msg;

  const wrap = document.createElement('div');
  wrap.className = `msg ${role}${isError ? ' error' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'U' : 'AI';
  wrap.appendChild(avatar);

  const col = document.createElement('div');
  col.className = 'msg-col';

  if (attachments && attachments.length) {
    const attWrap = document.createElement('div');
    attWrap.className = 'msg-attachments';
    for (const att of attachments) attWrap.appendChild(buildAttachmentChip(att));
    col.appendChild(attWrap);
  }

  if (thinking) {
    const details = document.createElement('details');
    details.className = 'thinking-block';
    const summary = document.createElement('summary');
    summary.textContent = `🧠 Proses berpikir${effortLabel ? ' — ' + effortLabel : ''}`;
    const box = document.createElement('div');
    box.className = 'thinking-content';
    box.textContent = thinking;
    details.appendChild(summary);
    details.appendChild(box);
    col.appendChild(details);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (isTyping) {
    bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  } else {
    const { cleaned, files } = parseFileBlocks(content || '');
    bubble.innerHTML = cleaned ? formatContent(cleaned) : '';

    if (files.length) {
      const filesWrap = document.createElement('div');
      filesWrap.className = 'files-wrap';
      for (const f of files) filesWrap.appendChild(buildFileCard(f));
      if (files.length > 1) {
        const zipBtn = document.createElement('button');
        zipBtn.type = 'button';
        zipBtn.className = 'btn-zip-all';
        zipBtn.textContent = `📦 Unduh Semua (${files.length} file) sebagai ZIP`;
        zipBtn.addEventListener('click', () => downloadFilesAsZip(files));
        filesWrap.appendChild(zipBtn);
      }
      bubble.appendChild(filesWrap);
    }
  }

  col.appendChild(bubble);
  wrap.appendChild(col);
  return wrap;
}

function buildTypingNode(cfg) {
  const node = buildMessageNode({ role: 'assistant', content: '' }, true);
  if (cfg.thinking) {
    const label = document.createElement('div');
    label.className = 'thinking-indicator';
    label.textContent = `🧠 Sedang berpikir mendalam (${cfg.label})…`;
    node.querySelector('.msg-col').insertBefore(label, node.querySelector('.bubble'));
  }
  return node;
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

/* ---------------------------- Composer ---------------------------- */

el.userInput.addEventListener('input', () => {
  el.userInput.style.height = 'auto';
  el.userInput.style.height = Math.min(el.userInput.scrollHeight, 160) + 'px';
});

el.userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    el.composerForm.requestSubmit();
  }
});

el.composerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el.userInput.value.trim();
  if ((!text && pendingAttachments.length === 0) || isStreaming) return;

  if (!settings.apiKey) {
    showToast('Masukkan API Key di menu Pengaturan terlebih dahulu.');
    openSettings();
    return;
  }

  if (!activeChatId || !chats[activeChatId]) {
    createNewChat();
  }

  const chat = chats[activeChatId];

  const hasImages = pendingAttachments.some((a) => a.kind === 'image');
  if (hasImages && settings.provider !== 'anthropic' && settings.provider !== 'openai') {
    showToast('Provider ini mungkin tidak mendukung lampiran gambar (vision) — respons bisa gagal atau mengabaikan gambar.');
  }

  const attachmentsForMsg = pendingAttachments.map((a) => ({ ...a }));
  chat.messages.push({ role: 'user', content: text, attachments: attachmentsForMsg });

  if (chat.title === 'Chat baru' || !chat.title) {
    const base = text || (attachmentsForMsg[0] && attachmentsForMsg[0].name) || 'Lampiran';
    chat.title = base.slice(0, 40) + (base.length > 40 ? '…' : '');
  }
  saveChats();
  renderHistoryList();
  renderMessages();

  el.userInput.value = '';
  el.userInput.style.height = 'auto';
  pendingAttachments = [];
  renderAttachmentsPreview();

  await sendToAI(chat);
});

/* ---------------------------- Prompt assembly ---------------------------- */

function buildEffectiveSystemPrompt(cfg) {
  const parts = [];
  if (settings.systemPrompt) parts.push(settings.systemPrompt);
  parts.push(FILE_CONVENTION_NOTE);
  if (cfg.promptHint) parts.push(cfg.promptHint);
  if (webSearchEnabled && settings.provider !== 'anthropic') {
    parts.push('Catatan: pengguna mengaktifkan pencarian web, tetapi provider/API ini tidak mendukung tool pencarian web bawaan — jawab semaksimal mungkin dari pengetahuanmu sendiri dan sebutkan keterbatasan ini bila relevan.');
  }
  return parts.join('\n\n');
}

/* ---------------------------- API calls ---------------------------- */

function buildOpenAiCompatibleBody(cfg) {
  const messages = [];
  const sys = buildEffectiveSystemPrompt(cfg);
  if (sys) messages.push({ role: 'system', content: sys });

  for (const m of chats[activeChatId].messages) {
    const parts = [];
    if (m.attachments && m.attachments.length) {
      for (const a of m.attachments) {
        if (a.kind === 'image' && a.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
        } else if (a.kind === 'file' && a.isText && a.textContent) {
          const truncated = a.textContent.length > MAX_TEXT_CHARS_FOR_API
            ? a.textContent.slice(0, MAX_TEXT_CHARS_FOR_API) + '\n…(dipotong)'
            : a.textContent;
          parts.push({ type: 'text', text: `[Isi file terlampir: ${a.name}]\n\`\`\`\n${truncated}\n\`\`\`` });
        }
      }
    }
    if (m.content) parts.push({ type: 'text', text: m.content });

    let content;
    if (parts.length === 0) content = '';
    else if (parts.length === 1 && parts[0].type === 'text') content = parts[0].text;
    else content = parts;

    messages.push({ role: m.role, content });
  }

  const body = {
    model: settings.model,
    messages,
    temperature: cfg.thinking ? 1 : settings.temperature,
  };
  if (settings.provider === 'openai') {
    body.reasoning_effort = cfg.reasoningEffort;
  }
  return body;
}

function buildAnthropicBody(cfg) {
  const messages = chats[activeChatId].messages.map((m) => {
    const blocks = [];
    if (m.attachments && m.attachments.length) {
      for (const a of m.attachments) {
        if (a.kind === 'image' && a.dataUrl) {
          const match = a.dataUrl.match(/^data:(.+);base64,(.*)$/);
          if (match) blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
        } else if (a.kind === 'file' && a.isText && a.textContent) {
          const truncated = a.textContent.length > MAX_TEXT_CHARS_FOR_API
            ? a.textContent.slice(0, MAX_TEXT_CHARS_FOR_API) + '\n…(dipotong)'
            : a.textContent;
          blocks.push({ type: 'text', text: `[Isi file terlampir: ${a.name}]\n\`\`\`\n${truncated}\n\`\`\`` });
        }
      }
    }
    if (m.content) blocks.push({ type: 'text', text: m.content });

    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blocks.length ? blocks : (m.content || ''),
    };
  });

  const body = {
    model: settings.model,
    max_tokens: cfg.maxTokens,
    messages,
  };

  const sys = buildEffectiveSystemPrompt(cfg);
  if (sys) body.system = sys;

  if (cfg.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: cfg.budget };
    body.temperature = 1; // wajib saat extended thinking aktif
  } else {
    body.temperature = settings.temperature;
  }

  if (webSearchEnabled) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  return body;
}

async function callOpenAiCompatible(cfg) {
  const url = `${settings.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(buildOpenAiCompatibleBody(cfg)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Respons API tidak valid atau kosong.');
  return { text: content, thinking: null };
}

async function callAnthropic(cfg) {
  const url = `${settings.baseUrl}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(buildAnthropicBody(cfg)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  let text = '';
  let thinking = '';
  if (Array.isArray(data?.content)) {
    for (const block of data.content) {
      if (block.type === 'text' && block.text) text += block.text;
      else if (block.type === 'thinking' && block.thinking) thinking += block.thinking;
    }
  }
  if (!text) throw new Error('Respons API tidak valid atau kosong.');
  return { text, thinking: thinking || null };
}

async function sendToAI(chat) {
  isStreaming = true;
  el.sendBtn.disabled = true;

  const cfg = EFFORT_LEVELS[currentEffort];
  const typingNode = buildTypingNode(cfg);
  el.messages.appendChild(typingNode);
  scrollToBottom();

  try {
    let result;
    if (settings.provider === 'anthropic') {
      result = await callAnthropic(cfg);
    } else {
      result = await callOpenAiCompatible(cfg);
    }
    chat.messages.push({
      role: 'assistant',
      content: result.text,
      thinking: result.thinking,
      effortLabel: cfg.label,
    });
    saveChats();
    renderMessages();
  } catch (err) {
    typingNode.remove();
    const errMsg = `⚠️ Gagal mendapatkan respons: ${err.message}`;
    chat.messages.push({ role: 'assistant', content: errMsg, isError: true });
    saveChats();
    renderMessages();
  } finally {
    isStreaming = false;
    el.sendBtn.disabled = false;
  }
}

/* ---------------------------- Init ---------------------------- */

function init() {
  if (!settings.baseUrl) settings.baseUrl = DEFAULT_BASE_URLS[settings.provider];
  if (settings.defaultEffort && EFFORT_LEVELS[settings.defaultEffort]) {
    currentEffort = settings.defaultEffort;
  }
  updateModelLabel();
  updateEffortUI();
  renderHistoryList();

  if (activeChatId && !chats[activeChatId]) activeChatId = null;
  if (!activeChatId && Object.keys(chats).length) {
    const sorted = Object.values(chats).sort((a, b) => b.createdAt - a.createdAt);
    setActiveChat(sorted[0].id);
  }
  renderMessages();
}

init();
