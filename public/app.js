import { normalizeUid, sha256Hex, randomSalt, randomDeviceSecret, deriveVaultKeys, importVaultKey, encryptVault, decryptVault, encryptDeviceSession, decryptDeviceSession } from './crypto.js';
import { getLocalVault, putLocalVault, deleteLocalVault, getRememberedSession, putRememberedSession, deleteRememberedSession, getCatalogCache, putCatalogCache, deleteCatalogCache, deleteCatalogCaches, getLastUid, setLastUid, clearLastUid, getKnownProfiles, rememberKnownProfile, forgetKnownProfile, getDeviceSecret, setDeviceSecret } from './storage.js';
import { emptyVault, filterPurchases, languageOptions, compareCatalog, filterComparison, setBookReadState, mergeVaults, toCsv, dedupe, sortBooks, publicationYear, topAuthors, norm, stableBookKey } from './model.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'unlockView','appView','unlockForm','headerVersion','uidInput','passwordInput','rememberDevice','unlockMessage','syncBadge','lockBtn','libraryMeta','knownProfileChooser','profileSelect','showBootstrapCreateBtn','bootstrapCreateForm','bootstrapUidInput','bootstrapPasswordInput','bootstrapPasswordConfirmInput',
  'refreshLibraryBtn','librarySearch','languageFilter','mediaFilter','librarySort','libraryCount','libraryGrid','libraryEmpty',
  'catalogForm','catalogMode','catalogQuery','catalogQueryLabel','catalogModeHelp','catalogLanguage','catalogStatus','compareStats','catalogSort','catalogGrid','catalogEmpty','forceCatalogRefreshBtn',
  'statsLanguage','statsMedia','statsRanking','statsLimit','statsRatingStatus','statsCount','statsGrid','statsEmpty',
  'koboConnected','koboConnectedMeta','copyAccessTokenBtn','copyRefreshTokenBtn','koboDisconnected','startActivationBtn','activationBox','activationCode',
  'activationLink','pollActivationBtn','activationStatus','disconnectKoboBtn','settingsUid','settingsVersion',
  'settingsUpdated','appVersion','workerVersion','sessionPersistence','sessionExpiry','cacheVersion','syncNowBtn','exportCsvBtn','exportJsonBtn','deleteVaultBtn','pwaMode','pwaManifest','pwaServiceWorker','pwaStorage','installAppBtn','refreshPwaBtn','pwaInstallHelp',
  'ratingDiagBook','runRatingDiagBtn','copyRatingDiagBtn','refreshAllRatingsBtn','ratingDiagResult',
  'runLibrarySyncProbeBtn','copyLibrarySyncProbeBtn','downloadLibrarySyncProbeBtn','librarySyncProbeResult',
  'projectionStatus','acquisitionAccessStatus','publishProjectionBtn','removeProjectionBtn','publishAcquisitionAccessBtn','removeAcquisitionAccessBtn','refreshIntegrationsBtn','apiTokenLabel','apiTokenLibraryRefresh','apiTokenDelegate','createApiTokenBtn','apiTokenResult','apiTokensList','knownProfilesSelect','switchProfileBtn','newVaultUid','newVaultPassword','newVaultPasswordConfirm','createVaultBtn','createVaultMessage','toast'
].map(id => [id, $(id)]));

let session = null;
let vault = null;
let activation = null;
let activationTimer = null;
let saveChain = Promise.resolve();
let toastTimer = null;
let currentCatalog = null;
let catalogFilter = 'all';
let catalogForceRefresh = false;
let deferredInstallPrompt = null;
let swRegistration = null;
let workerRelease = null;
const CATALOG_LOCAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMEMBER_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const RATING_BATCH_SIZE = 6;
const APP_VERSION = '0.9.7';
const SW_CACHE_VERSION = 'kobo-vault-v097';

init();

async function init() {
  els.uidInput.value = getLastUid();
  renderProfileSelectors();
  if (els.headerVersion) els.headerVersion.textContent = `v${APP_VERSION}`;
  bindEvents();
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await swRegistration.update().catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('kobo-vault:sw-reloaded') === APP_VERSION) return;
        sessionStorage.setItem('kobo-vault:sw-reloaded', APP_VERSION);
        location.reload();
      });
    } catch {}
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  updateCatalogModeUi();
  initFilterShells();
  refreshPwaDiagnostics();
  await tryAutoUnlock();
}

function bindEvents() {
  els.unlockForm.addEventListener('submit', unlock);
  els.profileSelect?.addEventListener('change', () => { if (els.profileSelect.value) els.uidInput.value = els.profileSelect.value; });
  els.showBootstrapCreateBtn?.addEventListener('click', () => els.bootstrapCreateForm?.classList.toggle('hidden'));
  els.bootstrapCreateForm?.addEventListener('submit', createBootstrapVault);
  els.switchProfileBtn?.addEventListener('click', switchVaultProfile);
  els.createVaultBtn?.addEventListener('click', createVaultFromCurrent);
  els.lockBtn.addEventListener('click', () => lock({ forgetRemembered: true }));
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
  els.librarySearch.addEventListener('input', renderLibrary);
  els.languageFilter.addEventListener('change', renderLibrary);
  els.mediaFilter.addEventListener('change', renderLibrary);
  els.librarySort.addEventListener('change', renderLibrary);
  els.refreshLibraryBtn.addEventListener('click', syncKoboLibrary);
  els.catalogForm.addEventListener('submit', searchCatalog);
  els.catalogMode.addEventListener('change', updateCatalogModeUi);
  els.catalogSort.addEventListener('change', () => currentCatalog && renderCatalogFilter(currentCatalog.comparison));
  els.forceCatalogRefreshBtn.addEventListener('click', () => { catalogForceRefresh = true; els.catalogForm.requestSubmit(); });
  els.statsLanguage.addEventListener('change', renderStats);
  els.statsMedia.addEventListener('change', renderStats);
  els.statsLimit.addEventListener('change', renderStats);
  els.statsRanking.addEventListener('change', () => { if (vault) { vault.settings.statsRanking = els.statsRanking.value; persistVault({ remote: false }); } renderStats(); });
  els.startActivationBtn.addEventListener('click', startActivation);
  els.pollActivationBtn.addEventListener('click', () => pollActivation(true));
  els.disconnectKoboBtn.addEventListener('click', disconnectKobo);
  els.copyAccessTokenBtn.addEventListener('click', () => copySecret('accessToken', 'Access token Kobo copié.'));
  els.copyRefreshTokenBtn.addEventListener('click', () => copySecret('refreshToken', 'Refresh token Kobo copié.'));
  els.syncNowBtn.addEventListener('click', syncVaultNow);
  els.exportCsvBtn.addEventListener('click', exportCsv);
  els.exportJsonBtn.addEventListener('click', exportJson);
  els.deleteVaultBtn.addEventListener('click', removeVault);
  els.installAppBtn.addEventListener('click', installPwa);
  els.refreshPwaBtn.addEventListener('click', refreshPwaDiagnostics);
  els.runRatingDiagBtn?.addEventListener('click', runRatingDiagnostic);
  els.copyRatingDiagBtn?.addEventListener('click', copyRatingDiagnostic);
  els.refreshAllRatingsBtn?.addEventListener('click', refreshAllRatings);
  els.runLibrarySyncProbeBtn?.addEventListener('click', runLibrarySyncProbe);
  els.copyLibrarySyncProbeBtn?.addEventListener('click', copyLibrarySyncProbe);
  els.downloadLibrarySyncProbeBtn?.addEventListener('click', downloadLibrarySyncProbe);
  els.publishProjectionBtn?.addEventListener('click', () => publishProjection({ notify: true, enable: true }));
  els.removeProjectionBtn?.addEventListener('click', removeProjection);
  els.refreshIntegrationsBtn?.addEventListener('click', refreshIntegrationPanel);
  els.createApiTokenBtn?.addEventListener('click', createConsumerApiToken);
  els.publishAcquisitionAccessBtn?.addEventListener('click', () => publishAcquisitionAccess({ notify:true, enable:true }));
  els.removeAcquisitionAccessBtn?.addEventListener('click', removeAcquisitionAccess);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; updateInstallUi(); });
  window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; refreshPwaDiagnostics(); toast('Application installée.'); });
  window.addEventListener('popstate', event => restoreNavigationState(event.state));
  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', refreshPwaDiagnostics);
  window.addEventListener('online', () => { if (session) setSyncBadge('En ligne', 'ok'); });
  window.addEventListener('offline', () => { if (session) setSyncBadge('Hors ligne', 'warn'); });
}

async function unlock(event) {
  event.preventDefault();
  const uid = normalizeUid(els.uidInput.value);
  const password = els.passwordInput.value;
  if (uid.length < 3 || password.length < 10) return showMessage(els.unlockMessage, 'UID ou mot de passe trop court.', 'error');
  setBusy(els.unlockForm.querySelector('button'), true, 'Ouverture…');
  showMessage(els.unlockMessage, 'Dérivation des clés et recherche du coffre…', 'info');
  try {
    const uidHash = await sha256Hex(uid);
    const local = await getLocalVault(uidHash);
    let meta = null;
    let offline = false;
    try { meta = await api(`/api/vault/${uidHash}/meta`); }
    catch (e) {
      if (!local) throw e;
      offline = true;
    }
    const salt = meta?.exists ? meta.salt : (local?.salt || randomSalt());
    const keys = await deriveVaultKeys(uid, password, salt);
    let loaded;
    let version = Number(local?.version || 0);
    let remoteUpdatedAt = local?.updatedAt || null;

    if (meta?.exists && !offline) {
      const remote = await api(`/api/vault/${uidHash}`, { headers: vaultHeaders(keys.authSecret) });
      loaded = await decryptVault(remote.blob, keys.encKey, uidHash);
      version = Number(remote.version || 0);
      remoteUpdatedAt = remote.updatedAt || null;
      await putLocalVault({ uidHash, salt, blob: remote.blob, version, updatedAt: remoteUpdatedAt });
    } else if (local?.blob) {
      loaded = await decryptVault(local.blob, keys.encKey, uidHash);
      if (meta && !meta.exists) {
        offline = true;
        version = Number(local?.version || 0);
      }
    } else {
      throw new Error('Compte Vault inconnu. La création implicite est désactivée ; créez le compte explicitement depuis un profil ouvert.');
    }

    const needsCompaction = vaultNeedsCompaction(loaded);
    session = { uid, uidHash, salt, encKey: keys.encKey, authSecret: keys.authSecret, version, remoteUpdatedAt, offline, rememberMaterial: keys.encKeyRaw };
    vault = normalizeVault(loaded);
    setLastUid(uid);
    rememberKnownProfile(uid);
    renderProfileSelectors();
    els.passwordInput.value = '';
    showApp();
    renderAll();

    if (offline) {
      setSyncBadge('Hors ligne · copie locale', 'warn');
      toast('Coffre ouvert depuis la copie locale.');
    } else {
      setSyncBadge('Synchronisé', 'ok');
      if (needsCompaction) {
        await persistVault({ remote: true });
        toast('Coffre compacté : l’ancien cache catalogue a été retiré de la synchronisation.');
      }
    }
    if (offline && needsCompaction) {
      await persistVault({ remote: false });
      toast('Copie locale compactée ; la version distante sera nettoyée à la prochaine synchronisation.');
    }
    if (els.rememberDevice?.checked) {
      const remembered = await rememberCurrentSession({ notify: true });
      if (!remembered) toast('La session persistante n’a pas pu être enregistrée sur cet appareil.', 'error');
    } else await deleteRememberedSession(session.uidHash).catch(() => {});
    if (session) delete session.rememberMaterial;
  } catch (e) {
    showMessage(els.unlockMessage, friendlyError(e), 'error');
    session = null; vault = null;
  } finally {
    setBusy(els.unlockForm.querySelector('button'), false);
  }
}

async function rememberCurrentSession({ notify = false } = {}) {
  if (!session?.uidHash || !session?.authSecret) return false;
  const encKeyRaw = session.rememberMaterial;
  if (!encKeyRaw) {
    session.remembered = false;
    session.rememberError = 'La clé de session n’est disponible qu’après une ouverture avec mot de passe.';
    return false;
  }
  const now = Date.now();
  try {
    let deviceSecret = getDeviceSecret();
    if (!deviceSecret) { deviceSecret = randomDeviceSecret(); setDeviceSecret(deviceSecret); }
    const expiresAt = new Date(now + REMEMBER_SESSION_TTL_MS).toISOString();
    const envelope = await encryptDeviceSession({
      uid: session.uid, salt: session.salt, encKeyRaw, authSecret: session.authSecret
    }, deviceSecret, session.uidHash);
    await putRememberedSession({
      uidHash: session.uidHash, format: 'v2-envelope', envelope,
      createdAt: new Date(now).toISOString(), expiresAt
    });
    session.remembered = true;
    session.rememberExpiresAt = expiresAt;
    session.rememberError = '';
    if (notify) toast('Session persistante activée sur cet appareil.');
    renderSettings();
    return true;
  } catch (e) {
    session.remembered = false;
    session.rememberError = friendlyError(e);
    renderSettings();
    return false;
  }
}

async function loadRememberedMaterial(record, uidHash) {
  if (record?.format === 'v2-envelope' && record.envelope) {
    const deviceSecret = getDeviceSecret();
    if (!deviceSecret) throw new Error('Secret local de session absent');
    const material = await decryptDeviceSession(record.envelope, deviceSecret, uidHash);
    if (!material?.encKeyRaw || !material?.authSecret || !material?.salt) throw new Error('Session locale incomplète');
    return { ...material, encKey: await importVaultKey(material.encKeyRaw) };
  }
  // Compatibilité V0.5.0 : si Firefox sait encore relire la CryptoKey clonée,
  // on tente une dernière ouverture. Sinon l’utilisateur se reconnecte une fois,
  // puis la session sera enregistrée au nouveau format v2.
  if (record?.encKey && record?.authSecret && record?.salt) {
    return { uid: record.uid, salt: record.salt, authSecret: record.authSecret, encKey: record.encKey, legacy: true };
  }
  throw new Error('Format de session locale obsolète');
}

async function tryAutoUnlock() {
  const uid = normalizeUid(getLastUid());
  if (!uid || session) return false;
  let uidHash;
  try { uidHash = await sha256Hex(uid); } catch { return false; }
  const remembered = await getRememberedSession(uidHash).catch(() => null);
  if (!remembered) return false;
  if (remembered.expiresAt && Date.parse(remembered.expiresAt) < Date.now()) { await deleteRememberedSession(uidHash).catch(() => {}); return false; }
  showMessage(els.unlockMessage, 'Réouverture de la session enregistrée…', 'info');
  try {
    const material = await loadRememberedMaterial(remembered, uidHash);
    const local = await getLocalVault(uidHash);
    let meta = null, offline = false, loaded = null, version = Number(local?.version || 0), remoteUpdatedAt = local?.updatedAt || null;
    try { meta = await api(`/api/vault/${uidHash}/meta`); } catch (e) { if (!local?.blob) throw e; offline = true; }
    if (meta?.exists && !offline) {
      const remote = await api(`/api/vault/${uidHash}`, { headers: vaultHeaders(material.authSecret) });
      loaded = await decryptVault(remote.blob, material.encKey, uidHash);
      version = Number(remote.version || 0); remoteUpdatedAt = remote.updatedAt || null;
      await putLocalVault({ uidHash, salt: material.salt, blob: remote.blob, version, updatedAt: remoteUpdatedAt });
    } else if (local?.blob) loaded = await decryptVault(local.blob, material.encKey, uidHash);
    else throw new Error('Session locale sans coffre disponible');
    const needsCompaction = vaultNeedsCompaction(loaded);
    session = {
      uid: material.uid || uid, uidHash, salt: material.salt, encKey: material.encKey,
      authSecret: material.authSecret, version, remoteUpdatedAt, offline, remembered: true,
      rememberExpiresAt: remembered.expiresAt || null, rememberLegacy: Boolean(material.legacy)
    };
    vault = normalizeVault(loaded);
    els.rememberDevice.checked = true;
    showApp(); renderAll();
    setSyncBadge(offline ? 'Hors ligne · session locale' : 'Synchronisé', offline ? 'warn' : 'ok');
    if (needsCompaction) {
      try {
        await persistVault({ remote: !offline });
        toast(offline ? 'Copie locale compactée.' : 'Coffre compacté automatiquement après mise à jour.');
      } catch (e) {
        toast(`Coffre ouvert, mais compactage différé : ${friendlyError(e)}`, 'error');
      }
    }
    showMessage(els.unlockMessage, '', 'info'); els.unlockMessage.classList.add('hidden');
    if (material.legacy) toast('Session V0.5 ouverte. Ressaisissez le mot de passe une fois si Firefox la perd afin de migrer au nouveau format.');
    return true;
  } catch (e) {
    await deleteRememberedSession(uidHash).catch(() => {});
    session = null; vault = null;
    showMessage(els.unlockMessage, `Session enregistrée inutilisable. Reconnectez-vous une fois pour activer le nouveau format persistant. ${friendlyError(e)}`, 'error');
    return false;
  }
}

function normalizeVault(v) {
  const base = emptyVault();
  // Le coffre synchronisé est volontairement une whitelist. Les données publiques
  // reconstructibles (notamment l'ancien catalogCache V0.3–V0.5.1) n'y entrent plus.
  return {
    schema: 4,
    updatedAt: v?.updatedAt || base.updatedAt,
    kobo: v?.kobo && typeof v.kobo === 'object' ? v.kobo : null,
    purchases: Array.isArray(v?.purchases) ? v.purchases : [],
    purchasesFetchedAt: v?.purchasesFetchedAt || null,
    bookStates: v?.bookStates && typeof v.bookStates === 'object' ? v.bookStates : {},
    settings: { ...base.settings, ...(v?.settings || {}) }
  };
}

function vaultNeedsCompaction(v) {
  return Number(v?.schema || 0) < 4 || Boolean(v?.catalogCache && typeof v.catalogCache === 'object' && Object.keys(v.catalogCache).length);
}

function showApp() {
  els.unlockView.classList.add('hidden');
  els.appView.classList.remove('hidden');
  els.lockBtn.classList.remove('hidden');
  els.unlockMessage.classList.add('hidden');
  const initial = navigationStateFromLocation();
  selectTab(initial.tab, { historyMode: 'replace', state: initial });
  restoreCatalogFormState(initial);
}

async function lock({ forgetRemembered = true } = {}) {
  clearActivationTimer();
  activation = null;
  currentCatalog = null;
  catalogFilter = 'all';
  const uidHash = session?.uidHash;
  if (forgetRemembered && uidHash) await deleteRememberedSession(uidHash).catch(() => {});
  const pendingSaves = saveChain;
  session = null;
  vault = null;
  if (forgetRemembered && uidHash) pendingSaves.catch(() => {}).finally(() => deleteRememberedSession(uidHash).catch(() => {}));
  els.appView.classList.add('hidden');
  els.unlockView.classList.remove('hidden');
  els.lockBtn.classList.add('hidden');
  setSyncBadge('Verrouillé', 'muted');
  els.passwordInput.value = '';
  if (els.apiTokenResult) { els.apiTokenResult.textContent = ''; els.apiTokenResult.classList.add('hidden'); }
  if (els.agentPairCode) els.agentPairCode.value = '';
  els.passwordInput.focus();
}


function renderProfileSelectors(preferred = '') {
  const profiles = getKnownProfiles();
  const selected = preferred || session?.uid || getLastUid() || '';
  for (const select of [els.profileSelect, els.knownProfilesSelect]) {
    if (!select) continue;
    const first = select === els.profileSelect ? 'Choisir un profil…' : 'Choisir un profil…';
    select.replaceChildren(new Option(first, ''));
    for (const uid of profiles) select.append(new Option(uid, uid));
    if (selected && profiles.includes(selected)) select.value = selected;
  }
  els.knownProfileChooser?.classList.toggle('hidden', profiles.length === 0);
  els.showBootstrapCreateBtn?.classList.toggle('hidden', profiles.length > 0 || Boolean(session));
}

async function createVaultRecord(uid, password) {
  const normalized = normalizeUid(uid);
  if (normalized.length < 3) throw new Error('UID trop court.');
  if (String(password || '').length < 10) throw new Error('Mot de passe trop court (10 caractères minimum).');
  const uidHash = await sha256Hex(normalized);
  const meta = await api(`/api/vault/${uidHash}/meta`);
  if (meta?.exists) throw new Error('Ce compte Vault existe déjà. Ouvrez-le au lieu de le recréer.');
  const salt = randomSalt();
  const keys = await deriveVaultKeys(normalized, password, salt);
  const createdVault = normalizeVault(emptyVault());
  createdVault.updatedAt = new Date().toISOString();
  const blob = await encryptVault(createdVault, keys.encKey, uidHash);
  const result = await api(`/api/vault/${uidHash}`, {
    method:'PUT', headers:vaultHeaders(keys.authSecret), body:{ salt, blob, expectedVersion:0 }
  });
  const version = Number(result.version || 1);
  const updatedAt = result.updatedAt || createdVault.updatedAt;
  await putLocalVault({ uidHash, salt, blob, version, updatedAt });
  rememberKnownProfile(normalized);
  return { uid:normalized, uidHash, salt, keys, createdVault, version, updatedAt };
}

async function activateCreatedVault(created, { remember = true } = {}) {
  await saveChain.catch(() => {});
  clearActivationTimer();
  session = {
    uid:created.uid, uidHash:created.uidHash, salt:created.salt, encKey:created.keys.encKey, authSecret:created.keys.authSecret,
    version:created.version, remoteUpdatedAt:created.updatedAt, offline:false, rememberMaterial:created.keys.encKeyRaw
  };
  vault = created.createdVault;
  setLastUid(created.uid);
  els.uidInput.value = created.uid;
  if (els.rememberDevice) els.rememberDevice.checked = remember;
  showApp(); renderAll(); setSyncBadge('Synchronisé', 'ok');
  if (remember) await rememberCurrentSession({ notify:false }).catch(() => false);
  if (session) delete session.rememberMaterial;
}

async function createVaultFromCurrent() {
  if (!session) return;
  const uid = String(els.newVaultUid?.value || '');
  const password = String(els.newVaultPassword?.value || '');
  const confirmPassword = String(els.newVaultPasswordConfirm?.value || '');
  if (password !== confirmPassword) return showMessage(els.createVaultMessage, 'Les mots de passe ne correspondent pas.', 'error');
  setBusy(els.createVaultBtn, true, 'Création…');
  showMessage(els.createVaultMessage, 'Création explicite du nouveau coffre…', 'info');
  try {
    await persistVault({ remote:true });
    const created = await createVaultRecord(uid, password);
    await activateCreatedVault(created, { remember:true });
    els.newVaultUid.value = ''; els.newVaultPassword.value = ''; els.newVaultPasswordConfirm.value = '';
    showMessage(els.createVaultMessage, '', 'info'); els.createVaultMessage.classList.add('hidden');
    toast(`Compte Vault « ${created.uid} » créé et ouvert.`);
  } catch (e) { showMessage(els.createVaultMessage, friendlyError(e), 'error'); }
  finally { setBusy(els.createVaultBtn, false); }
}

async function createBootstrapVault(event) {
  event.preventDefault();
  const uid = String(els.bootstrapUidInput?.value || '');
  const password = String(els.bootstrapPasswordInput?.value || '');
  const confirmPassword = String(els.bootstrapPasswordConfirmInput?.value || '');
  if (password !== confirmPassword) return showMessage(els.unlockMessage, 'Les mots de passe ne correspondent pas.', 'error');
  const button = els.bootstrapCreateForm?.querySelector('button');
  setBusy(button, true, 'Création…');
  try {
    const created = await createVaultRecord(uid, password);
    await activateCreatedVault(created, { remember:true });
    toast(`Premier compte Vault « ${created.uid} » créé explicitement.`);
  } catch (e) { showMessage(els.unlockMessage, friendlyError(e), 'error'); }
  finally { setBusy(button, false); }
}

async function switchVaultProfile() {
  const target = String(els.knownProfilesSelect?.value || '');
  if (!target || target === session?.uid) return;
  try { await persistVault({ remote:true }); } catch (e) { toast(`Synchronisation du profil courant impossible : ${friendlyError(e)}`, 'error'); return; }
  await lock({ forgetRemembered:false });
  setLastUid(target);
  els.uidInput.value = target;
  renderProfileSelectors(target);
  if (!(await tryAutoUnlock())) els.passwordInput?.focus();
}


function renderAll() {
  renderLibraryLanguageOptions();
  renderLibrary();
  if (els.statsRanking && vault.settings?.statsRanking) els.statsRanking.value = vault.settings.statsRanking;
  renderStats();
  renderKobo();
  renderSettings();
  renderProfileSelectors();
  refreshPwaDiagnostics();
  updateFilterSummaries();
}

const VALID_TABS = new Set(['library','catalog','stats','kobo','settings']);
function selectTab(tab, { historyMode = 'push', state = null } = {}) {
  const target = VALID_TABS.has(tab) ? tab : 'library';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
  document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('active', p.dataset.page === target));
  if (!session) return;
  const nav = { ...(state || {}), tab: target, ...(target === 'catalog' ? catalogFormState() : {}) };
  const url = new URL(location.href); url.hash = `tab=${encodeURIComponent(target)}`;
  if (historyMode === 'replace') history.replaceState(nav, '', url);
  else if (historyMode === 'push') {
    const current = history.state?.tab;
    if (current !== target || target === 'catalog') history.pushState(nav, '', url);
    else history.replaceState(nav, '', url);
  }
  if (target === 'settings') refreshIntegrationPanel().catch(() => {});
}
function navigationStateFromLocation() {
  const fromState = history.state?.tab;
  if (VALID_TABS.has(fromState)) return history.state;
  const match = location.hash.match(/(?:^#|&)tab=([^&]+)/);
  const fromHash = match ? decodeURIComponent(match[1]) : '';
  return { tab: VALID_TABS.has(fromHash) ? fromHash : 'library' };
}
function restoreNavigationState(state) {
  if (!session) return;
  const nav = state?.tab ? state : navigationStateFromLocation();
  selectTab(nav.tab, { historyMode: 'none', state: nav });
  restoreCatalogFormState(nav);
}
function catalogFormState() {
  return { catalogMode: els.catalogMode?.value || 'author', catalogQuery: els.catalogQuery?.value || '', catalogLanguage: els.catalogLanguage?.value || '' };
}
function restoreCatalogFormState(state) {
  if (!state || state.tab !== 'catalog') return;
  if (state.catalogMode) els.catalogMode.value = state.catalogMode;
  if (typeof state.catalogQuery === 'string') els.catalogQuery.value = state.catalogQuery;
  if (typeof state.catalogLanguage === 'string') els.catalogLanguage.value = state.catalogLanguage;
  updateCatalogModeUi();
}
function updateCatalogModeUi() {
  if (!els.catalogMode || !els.catalogQuery) return;
  const mode = els.catalogMode.value;
  const config = mode === 'series'
    ? { label: 'Série / collection', placeholder: 'ex. Commissaire Maigret', help: 'Le mode Série / collection recherche chez Kobo puis exige une correspondance avec le champ série/collection quand il est fourni.' }
    : mode === 'free'
      ? { label: 'Recherche libre', placeholder: 'ex. Prix du Quai des Orfèvres', help: 'La recherche libre compare les résultats Kobo à vos achats. Placez une expression entre guillemets doubles pour exiger cette correspondance exacte ; les termes hors guillemets restent également requis.' }
      : { label: 'Auteur', placeholder: 'ex. Ursula K. Le Guin', help: 'Le mode Auteur applique un contrôle strict du nom d’auteur après la recherche Kobo pour éviter les faux positifs.' };
  els.catalogQueryLabel.textContent = config.label;
  els.catalogQuery.placeholder = config.placeholder;
  els.catalogModeHelp.textContent = config.help;
  updateFilterSummaries();
}

function initFilterShells() {
  const mobile = window.matchMedia?.('(max-width: 760px)')?.matches === true;
  document.querySelectorAll('[data-filter-shell]').forEach(shell => {
    const key = shell.dataset.filterShell;
    const saved = localStorage.getItem(`kobo-vault:filters:${key}`);
    setFilterShellExpanded(shell, saved ? saved === 'open' : !mobile);
    shell.querySelector('[data-filter-toggle]')?.addEventListener('click', () => {
      const expanded = shell.querySelector('[data-filter-toggle]')?.getAttribute('aria-expanded') === 'true';
      setFilterShellExpanded(shell, !expanded); localStorage.setItem(`kobo-vault:filters:${key}`, !expanded ? 'open' : 'closed');
    });
    shell.querySelector('[data-filter-reset]')?.addEventListener('click', () => resetFilterShell(key));
    shell.addEventListener('input', updateFilterSummaries); shell.addEventListener('change', updateFilterSummaries);
  });
  updateFilterSummaries();
}
function setFilterShellExpanded(shell, expanded) {
  const toggle = shell.querySelector('[data-filter-toggle]'), body = shell.querySelector('[data-filter-body]');
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (body) body.classList.toggle('filter-collapsed', !expanded);
  shell.classList.toggle('is-collapsed', !expanded);
}
function resetFilterShell(key) {
  if (key === 'library') { els.librarySearch.value=''; els.languageFilter.value=''; els.mediaFilter.value=''; els.librarySort.value='title-asc'; renderLibrary(); }
  else if (key === 'catalog') { els.catalogMode.value='author'; els.catalogQuery.value=''; els.catalogLanguage.value=''; updateCatalogModeUi(); catalogFilter='all'; }
  else if (key === 'stats') { els.statsLanguage.value=''; els.statsMedia.value=''; els.statsRanking.value='count'; els.statsLimit.value='20'; if(vault){vault.settings.statsRanking='count';persistVault({remote:false});} renderStats(); }
  updateFilterSummaries();
}
function updateFilterSummaries() {
  document.querySelectorAll('[data-filter-shell]').forEach(shell => {
    const out = shell.querySelector('[data-filter-summary]'); if (!out) return;
    const key = shell.dataset.filterShell; const bits=[];
    if (key==='library') { if(els.librarySearch?.value)bits.push(`« ${els.librarySearch.value} »`); if(els.languageFilter?.value)bits.push(languageLabel(els.languageFilter.value)); if(els.mediaFilter?.value)bits.push(els.mediaFilter.options[els.mediaFilter.selectedIndex]?.textContent); if(els.librarySort?.value&&els.librarySort.value!=='title-asc')bits.push('tri personnalisé'); }
    if (key==='catalog') { if(els.catalogQuery?.value)bits.push(`« ${els.catalogQuery.value} »`); if(els.catalogMode?.value&&els.catalogMode.value!=='author')bits.push(els.catalogMode.options[els.catalogMode.selectedIndex]?.textContent); if(els.catalogLanguage?.value)bits.push(languageLabel(els.catalogLanguage.value)); }
    if (key==='stats') { if(els.statsLanguage?.value)bits.push(languageLabel(els.statsLanguage.value)); if(els.statsMedia?.value)bits.push(els.statsMedia.options[els.statsMedia.selectedIndex]?.textContent); if(els.statsRanking?.value==='weighted')bits.push('pondéré ★'); if(els.statsLimit?.value&&els.statsLimit.value!=='20')bits.push(els.statsLimit.options[els.statsLimit.selectedIndex]?.textContent); }
    out.textContent = bits.length ? bits.join(' · ') : 'Aucun filtre actif';
  });
}

function renderLibraryLanguageOptions() {
  const current = els.languageFilter.value;
  const opts = languageOptions(vault?.purchases || []);
  els.languageFilter.replaceChildren(option('', 'Toutes'), ...opts.map(v => option(v, languageLabel(v))));
  if (opts.includes(current)) els.languageFilter.value = current;
  const statsCurrent = els.statsLanguage.value;
  els.statsLanguage.replaceChildren(option('', 'Toutes'), ...opts.map(v => option(v, languageLabel(v))));
  if (opts.includes(statsCurrent)) els.statsLanguage.value = statsCurrent;
}

function renderLibrary() {
  if (!vault) return;
  const filtered = sortBooks(filterPurchases(vault.purchases, {
    search: els.librarySearch.value,
    language: els.languageFilter.value,
    mediaType: els.mediaFilter.value
  }), els.librarySort.value);
  els.libraryCount.textContent = String(filtered.length);
  els.libraryMeta.textContent = vault.purchasesFetchedAt
    ? `${vault.purchases.length} acquisition(s) · Kobo synchronisé ${formatDate(vault.purchasesFetchedAt)}`
    : `${vault.purchases.length} acquisition(s) dans le coffre`;
  els.libraryGrid.replaceChildren(...filtered.map(b => bookCard(b, { status: 'owned', authorNav: true })));
  els.libraryEmpty.classList.toggle('hidden', filtered.length > 0);
}

function bookCard(book, { status = '', authorNav = false } = {}) {
  const article = document.createElement('article');
  article.className = 'book-card';
  const cover = document.createElement('div');
  cover.className = 'cover';
  const coverSrc = displayCoverUrl(book, { width: 120, height: 180 });
  if (coverSrc) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = coverSrc;
    img.addEventListener('error', () => img.remove(), { once: true });
    cover.append(img);
  }
  const body = document.createElement('div');
  body.className = 'book-body';

  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.className = 'book-title-link';
  titleLink.textContent = book.title || 'Sans titre';
  titleLink.href = koboBookUrl(book);
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.title = 'Ouvrir ce titre sur Kobo';
  title.append(titleLink);

  const author = document.createElement('p');
  author.className = 'book-author';
  const authors = book.authors || [];
  if (!authors.length) author.textContent = 'Auteur inconnu';
  else authors.forEach((name, index) => {
    if (index) author.append(document.createTextNode(', '));
    if (authorNav) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'author-link'; btn.textContent = name;
      btn.title = `Rapprocher ${name} avec le catalogue Kobo`;
      btn.addEventListener('click', () => openReconciliation('author', name));
      author.append(btn);
    } else author.append(document.createTextNode(name));
  });

  const meta = document.createElement('p'); meta.className = 'book-meta';
  const year = publicationYear(book.publicationDate);
  const communityRating = Number.isFinite(Number(book.averageRating)) && Number(book.averageRating) > 0 ? `★ ${formatRating(book.averageRating)}${Number.isFinite(Number(book.ratingCount)) && Number(book.ratingCount) > 0 ? ` (${Number(book.ratingCount).toLocaleString('fr-FR')})` : ''}` : '';
  meta.textContent = [year ? `(${year})` : '', communityRating, languageLabel(book.language), book.series, book.publisher].filter(Boolean).join(' · ');
  body.append(title, author, meta);

  if (status) {
    const badge = document.createElement('span');
    badge.className = `badge book-state ${status === 'missing' ? 'warn' : status === 'read' ? 'known' : 'owned'}`;
    badge.textContent = status === 'missing' ? 'Potentiellement manquant' : status === 'read' ? 'Lu / déjà connu' : 'Possédé';
    body.append(badge);
  }

  if (status === 'missing' || status === 'read') {
    const actions = document.createElement('div'); actions.className = 'book-actions';
    const mark = document.createElement('button');
    mark.type = 'button'; mark.className = 'tiny ghost';
    mark.textContent = status === 'read' ? 'Ne plus marquer comme lu' : 'Marquer lu / déjà connu';
    mark.addEventListener('click', () => toggleKnownRead(book, status !== 'read', mark));
    actions.append(mark); body.append(actions);
  }

  article.append(cover, body);
  return article;
}

function koboBookUrl(book) {
  const candidate = String(book?.koboUrl || '').trim();
  if (candidate) {
    try {
      const u = new URL(candidate, 'https://www.kobo.com');
      if (u.protocol === 'https:' && (u.hostname === 'kobo.com' || u.hostname.endsWith('.kobo.com'))) return u.toString();
    } catch {}
  }
  const query = book?.isbn || [book?.title, ...(book?.authors || []).slice(0, 1)].filter(Boolean).join(' ');
  return `https://www.kobo.com/fr/fr/search?query=${encodeURIComponent(query || '')}`;
}

function openReconciliation(mode, query) {
  const value = String(query || '').trim();
  if (!value) return;
  els.catalogMode.value = mode || 'free';
  els.catalogQuery.value = value;
  els.catalogLanguage.value = '';
  updateCatalogModeUi();
  selectTab('catalog', { historyMode: 'push', state: { tab: 'catalog', ...catalogFormState() } });
  els.catalogForm.requestSubmit();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function toggleKnownRead(book, read, button) {
  if (!vault) return;
  setBusy(button, true, read ? 'Marquage…' : 'Mise à jour…');
  try {
    vault.bookStates = setBookReadState(vault.bookStates, book, read);
    vault.updatedAt = new Date().toISOString();
    if (currentCatalog) {
      currentCatalog.comparison = compareCatalog(vault.purchases, currentCatalog.items, { mode: currentCatalog.mode, query: currentCatalog.query, language: currentCatalog.language }, vault.bookStates);
      renderCatalogComparison(currentCatalog.comparison, currentCatalog.data, { preserveStatus: true });
    }
    await persistVault({ remote: true });
    toast(read ? 'Titre marqué comme lu / déjà connu.' : 'Marquage retiré.');
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(button, false); }
}

function renderKobo() {
  const connected = Boolean(vault?.kobo?.accessToken);
  els.koboConnected.classList.toggle('hidden', !connected);
  els.koboDisconnected.classList.toggle('hidden', connected);
  els.disconnectKoboBtn.classList.toggle('hidden', !connected);
  if (connected) {
    const bits = [];
    if (vault.kobo.userId) bits.push(`ID ${vault.kobo.userId}`);
    if (vault.kobo.appVersion) bits.push(`client ${vault.kobo.appVersion}`);
    els.koboConnectedMeta.textContent = bits.join(' · ') || 'Jetons stockés dans le coffre chiffré.';
  }
}


function normalizeCoverUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function displayCoverUrl(book, { width = 300, height = 450 } = {}) {
  const direct = normalizeCoverUrl(book?.coverUrl);
  if (direct) return direct;
  if (!book?.coverImageId) return '';
  return `https://cdn.kobo.com/book-images/${encodeURIComponent(book.coverImageId)}/${width}/${height}/90/false/image.jpg`;
}

function projectionCoverUrl(book) {
  return displayCoverUrl(book, { width: 300, height: 450 });
}

async function buildProjectionPayload() {
  const rawAccount = String(vault?.kobo?.userId || session?.uidHash || 'kobo-vault');
  const accountId = await sha256Hex(`kobo-account:${rawAccount}`);
  const items = (vault?.purchases || []).map(book => ({
    product_id: book.productId || book.revisionId || '',
    revision_id: book.revisionId || '',
    isbn: book.isbn || '',
    title: book.title || '(sans titre)',
    authors: Array.isArray(book.authors) ? book.authors : [],
    language: book.language || '',
    publisher: book.publisher || '',
    publication_date: book.publicationDate || '',
    cover_url: projectionCoverUrl(book),
    product_url: book.koboUrl || '',
    format: book.mediaType === 'ebook' ? 'EPUB' : '',
    content_type: book.mediaType || 'ebook',
    downloadable: book.mediaType === 'ebook',
    archived: Boolean(book.archived)
  })).filter(item => item.product_id);
  return {
    account: { id: accountId, display_name: 'Compte Kobo lié' },
    source_sync_at: vault?.purchasesFetchedAt || null,
    items
  };
}

async function publishProjection({ notify = false, enable = false } = {}) {
  if (!session || !vault) return false;
  setBusy(els.publishProjectionBtn, true, 'Publication…');
  try {
    if (enable && vault?.settings) vault.settings.apiProjectionEnabled = true;
    const body = await buildProjectionPayload();
    const data = await api(`/api/v2/vault/${session.uidHash}/projection`, {
      method: 'PUT', headers: vaultHeaders(session.authSecret), body
    });
    if (els.projectionStatus) els.projectionStatus.textContent = `${data.count || 0} notice(s) · ${formatDate(data.updated_at)}`;
    if (enable) await persistVault({ remote: true });
    if (notify) toast(`Manifest API publié : ${data.count || 0} notice(s).`);
    return true;
  } catch (e) {
    if (notify) toast(`Publication impossible : ${friendlyError(e)}`, 'error');
    return false;
  } finally {
    setBusy(els.publishProjectionBtn, false);
  }
}

async function removeProjection() {
  if (!session || !vault) return;
  if (!confirm('Retirer de Cloudflare la projection de métadonnées utilisée par Paris Library ? Le coffre chiffré reste intact.')) return;
  setBusy(els.removeProjectionBtn, true, 'Suppression…');
  try {
    await api(`/api/v2/vault/${session.uidHash}/projection`, { method:'DELETE', headers:vaultHeaders(session.authSecret) });
    vault.settings.apiProjectionEnabled = false;
    await persistVault({ remote:true });
    toast('Projection API supprimée.');
    await refreshIntegrationPanel();
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(els.removeProjectionBtn, false); }
}

function integrationEmpty(text) {
  const div = document.createElement('div'); div.className = 'muted-text'; div.textContent = text; return div;
}

function integrationItem(title, meta, buttonLabel, onClick, danger = false) {
  const row = document.createElement('div'); row.className = 'integration-item';
  const main = document.createElement('div'); main.className = 'integration-item-main';
  const strong = document.createElement('strong'); strong.textContent = title;
  const small = document.createElement('small'); small.textContent = meta || '';
  main.append(strong, small); row.append(main);
  if (buttonLabel) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = buttonLabel;
    if (danger) btn.className = 'danger ghost';
    btn.addEventListener('click', onClick); row.append(btn);
  }
  return row;
}

async function refreshIntegrationPanel() {
  if (!session || !els.projectionStatus) return;
  setBusy(els.refreshIntegrationsBtn, true, 'Actualisation…');
  try {
    const headers = vaultHeaders(session.authSecret);
    const [projection, acquisition, tokens] = await Promise.all([
      api(`/api/v2/vault/${session.uidHash}/projection`, { headers }),
      api(`/api/v2/vault/${session.uidHash}/acquisition-access`, { headers }),
      api(`/api/v2/vault/${session.uidHash}/api-tokens`, { headers })
    ]);
    els.projectionStatus.textContent = projection.updated_at ? `${projection.count} notice(s) · ${formatDate(projection.updated_at)}` : 'Non publiée';
    if (els.acquisitionAccessStatus) {
      els.acquisitionAccessStatus.textContent = acquisition.enabled
        ? `Activé · ${formatDate(acquisition.updated_at)}`
        : (acquisition.server_key_configured ? 'Désactivé' : 'Désactivé · secret Cloudflare à configurer');
    }
    renderApiTokens(tokens.items || []);
  } catch (e) {
    els.projectionStatus.textContent = `Indisponible · ${friendlyError(e)}`;
    if (els.acquisitionAccessStatus) els.acquisitionAccessStatus.textContent = 'Indisponible';
  } finally {
    setBusy(els.refreshIntegrationsBtn, false);
  }
}

function renderApiTokens(items) {
  if (!els.apiTokensList) return;
  els.apiTokensList.replaceChildren();
  const v2 = items.filter(token => (token.scopes || []).some(scope => String(scope).startsWith('kobo.')));
  if (!v2.length) return els.apiTokensList.append(integrationEmpty('Aucun token API v2 actif.'));
  for (const token of v2) {
    const used = token.last_used_at ? ` · utilisé ${formatDate(token.last_used_at)}` : '';
    const hasDelegate = (token.scopes || []).includes('kobo.acquisition.delegate');
    const hasLibraryRefresh = (token.scopes || []).includes('kobo.library.refresh');
    const warning = `${hasDelegate ? '' : ' · ⚠ KDRM délégué indisponible'}${hasLibraryRefresh ? '' : ' · ⚠ refresh bibliothèque explicite indisponible'}`;
    const row = integrationItem(token.label || token.id, `${(token.scopes || []).join(', ')}${warning} · créé ${formatDate(token.created_at)}${used}`, 'Révoquer', async () => {
      if (!confirm(`Révoquer le token « ${token.label || token.id} » ?`)) return;
      try {
        await api(`/api/v2/vault/${session.uidHash}/api-tokens/${encodeURIComponent(token.id)}`, { method:'DELETE', headers:vaultHeaders(session.authSecret) });
        toast('Token API révoqué.'); await refreshIntegrationPanel();
      } catch (e) { toast(friendlyError(e), 'error'); }
    }, true);
    if (!hasDelegate) row.classList.add('scope-warning');
    els.apiTokensList.append(row);
  }
}

async function createConsumerApiToken() {
  if (!session) return;
  setBusy(els.createApiTokenBtn, true, 'Création…');
  try {
    const label = String(els.apiTokenLabel?.value || 'Paris Library').trim() || 'Paris Library';
    const data = await api(`/api/v2/vault/${session.uidHash}/api-tokens`, {
      method:'POST', headers:vaultHeaders(session.authSecret),
      body:{ label, scopes:[...['kobo.catalog.read','kobo.library.read','kobo.acquisition.read'], ...(els.apiTokenLibraryRefresh?.checked ? ['kobo.library.refresh'] : []), ...(els.apiTokenDelegate?.checked ? ['kobo.acquisition.delegate'] : [])] }
    });
    const value = data.token?.value || '';
    if (els.apiTokenResult) {
      els.apiTokenResult.textContent = `Token affiché une seule fois :\n${value}\n\nUtilisez : Authorization: Bearer <token>`;
      els.apiTokenResult.classList.remove('hidden');
    }
    try { if (value) await navigator.clipboard.writeText(value); } catch {}
    toast(value ? 'Token API v2 créé. Il a été copié si le navigateur l’autorise.' : 'Token créé.');
    await refreshIntegrationPanel();
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(els.createApiTokenBtn, false); }
}

async function publishAcquisitionAccess({ notify = false, enable = false } = {}) {
  if (!session || !vault?.kobo?.accessToken) {
    if (notify) toast('Connectez d’abord votre compte Kobo.', 'error');
    return false;
  }
  setBusy(els.publishAcquisitionAccessBtn, true, 'Publication…');
  try {
    const k = vault.kobo;
    const data = await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, {
      method:'PUT', headers:vaultHeaders(session.authSecret),
      body:{ accessToken:k.accessToken, refreshToken:k.refreshToken || '', appVersion:k.appVersion || '', userId:k.userId || '', deviceId:k.deviceId || '', serialNumber:k.serialNumber || '' }
    });
    if (enable && vault?.settings) {
      vault.settings.apiAcquisitionEnabled = true;
      await persistVault({ remote:true });
    }
    if (els.acquisitionAccessStatus) els.acquisitionAccessStatus.textContent = `Activé · ${formatDate(data.updated_at)}`;
    if (notify) toast('Accès Provider Kobo activé. Les jetons sont chiffrés côté serveur.');
    return true;
  } catch (e) {
    if (notify) toast(`Activation impossible : ${friendlyError(e)}`, 'error');
    return false;
  } finally { setBusy(els.publishAcquisitionAccessBtn, false); }
}

async function removeAcquisitionAccess() {
  if (!session || !vault) return;
  if (!confirm('Désactiver l’accès Provider Kobo et supprimer la copie serveur chiffrée des jetons Kobo ?')) return;
  setBusy(els.removeAcquisitionAccessBtn, true, 'Suppression…');
  try {
    await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, { method:'DELETE', headers:vaultHeaders(session.authSecret) });
    vault.settings.apiAcquisitionEnabled = false;
    await persistVault({ remote:true });
    toast('Accès d’acquisition désactivé.');
    await refreshIntegrationPanel();
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(els.removeAcquisitionAccessBtn, false); }
}

async function renderSettings() {
  if (!session) return;
  els.settingsUid.textContent = session.uid;
  els.settingsVersion.textContent = String(session.version || 0);
  els.settingsUpdated.textContent = session.remoteUpdatedAt ? formatDate(session.remoteUpdatedAt) : 'Pas encore synchronisé';
  if (els.appVersion) els.appVersion.textContent = APP_VERSION;
  if (els.cacheVersion) els.cacheVersion.textContent = SW_CACHE_VERSION;
  if (els.sessionPersistence) {
    els.sessionPersistence.textContent = session.remembered ? (session.rememberLegacy ? 'Active · ancien format V0.5' : 'Active · format robuste v2') : (session.rememberError ? `Échec · ${session.rememberError}` : 'Inactive');
  }
  if (els.sessionExpiry) els.sessionExpiry.textContent = session.rememberExpiresAt ? formatDate(session.rememberExpiresAt) : '—';
  renderRatingDiagnosticOptions();
  if (els.workerVersion) {
    try {
      if (!workerRelease) { const health = await api('/api/health'); workerRelease = health.version || 'Inconnue'; }
      els.workerVersion.textContent = workerRelease;
    } catch { els.workerVersion.textContent = 'Indisponible'; }
  }
}

function renderRatingDiagnosticOptions() {
  if (!els.ratingDiagBook || !vault) return;
  const current = els.ratingDiagBook.value;
  const books = [...(vault.purchases || [])].sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'fr',{sensitivity:'base'}));
  els.ratingDiagBook.replaceChildren(option('', books.length ? 'Choisir un livre…' : 'Bibliothèque vide'), ...books.map(book => {
    const key = ratingBookKey(book);
    const author = book.authors?.[0] ? ` — ${book.authors[0]}` : '';
    const rated = book.averageRating ? ` · ★ ${formatRating(book.averageRating)}${book.ratingCount != null ? ` (${book.ratingCount})` : ''}` : '';
    return option(key, `${book.title || '(sans titre)'}${author}${rated}`);
  }));
  if ([...els.ratingDiagBook.options].some(o=>o.value===current)) els.ratingDiagBook.value=current;
}

function diagnosticBookByKey(key) {
  return (vault?.purchases || []).find(book => ratingBookKey(book) === key) || null;
}

async function runRatingDiagnostic() {
  if (!vault?.kobo?.accessToken) return toast('Connectez d’abord votre compte Kobo.', 'error');
  const book = diagnosticBookByKey(els.ratingDiagBook?.value);
  if (!book) return toast('Choisissez un livre à diagnostiquer.', 'error');
  setBusy(els.runRatingDiagBtn, true, 'Diagnostic…');
  try {
    const k = vault.kobo;
    const data = await api('/api/kobo/ratings/diagnostic', { method:'POST', body:{
      accessToken:k.accessToken, refreshToken:k.refreshToken, appVersion:k.appVersion,
      book:{ clientKey:ratingBookKey(book), productId:book.productId||'', revisionId:book.revisionId||'', isbn:book.isbn||'', title:book.title||'', authors:book.authors||[], language:book.language||'', mediaType:book.mediaType||'ebook', koboUrl:book.koboUrl||'', averageRating:book.averageRating??null, ratingCount:book.ratingCount??null }
    }});
    if (data.auth) { vault.kobo={...vault.kobo,...data.auth}; await persistVault({remote:true}); }
    if (els.ratingDiagResult) { els.ratingDiagResult.textContent = JSON.stringify(data, null, 2); els.ratingDiagResult.classList.remove('hidden'); }
    if (els.copyRatingDiagBtn) els.copyRatingDiagBtn.classList.remove('hidden');
    const r=data.result;
    if (r?.averageRating != null) toast(`Note trouvée : ★ ${formatRating(r.averageRating)}${r.ratingCount != null ? ` (${r.ratingCount})` : ''} via ${r.source}.`);
    else toast('Aucune note trouvée. Le diagnostic détaille les endpoints et champs observés.', 'error');
  } catch(e) { toast(friendlyError(e),'error'); }
  finally { setBusy(els.runRatingDiagBtn,false); }
}

async function copyRatingDiagnostic() {
  const text=els.ratingDiagResult?.textContent||''; if(!text)return;
  try { await navigator.clipboard.writeText(text); toast('Diagnostic copié.'); }
  catch { toast('Impossible de copier le diagnostic.', 'error'); }
}

async function runLibrarySyncProbe() {
  if (!session || !vault?.kobo?.accessToken) return toast('Connectez d’abord votre compte Kobo.', 'error');
  setBusy(els.runLibrarySyncProbeBtn, true, 'Diagnostic…');
  let temporaryAccess = false;
  try {
    const headers = vaultHeaders(session.authSecret);
    let acquisition = await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, { headers });
    if (!acquisition.enabled) {
      const k = vault.kobo;
      await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, {
        method:'PUT', headers,
        body:{ accessToken:k.accessToken, refreshToken:k.refreshToken || '', appVersion:k.appVersion || '', userId:k.userId || '', deviceId:k.deviceId || '', serialNumber:k.serialNumber || '' }
      });
      temporaryAccess = true;
    }
    const productIds = [...new Set((vault?.purchases || [])
      .map(book => book.productId || book.revisionId || '')
      .filter(Boolean))].slice(0, 3);
    if (!productIds.length) throw new Error('Aucun livre synchronisé avec un ProductId Kobo exploitable.');
    const data = await api(`/api/v2/vault/${session.uidHash}/diagnostics/library-sync`, {
      method:'POST', headers,
      body:{ probe_urls:true, product_ids:productIds }
    });
    const text = JSON.stringify(data, null, 2);
    if (els.librarySyncProbeResult) { els.librarySyncProbeResult.textContent = text; els.librarySyncProbeResult.classList.remove('hidden'); }
    els.copyLibrarySyncProbeBtn?.classList.remove('hidden');
    els.downloadLibrarySyncProbeBtn?.classList.remove('hidden');
    const detected = (data.books || []).filter(b => b.library_sync_recipe_present).length;
    toast(`Diagnostic library_sync terminé : ${detected}/${(data.books || []).length} titre(s) avec recette candidate.`);
  } catch (e) {
    toast(`Diagnostic impossible : ${friendlyError(e)}`, 'error');
  } finally {
    if (temporaryAccess) {
      try { await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, { method:'DELETE', headers:vaultHeaders(session.authSecret) }); }
      catch { toast('Diagnostic terminé, mais la publication temporaire des jetons n’a pas pu être supprimée. Vérifiez “Accès Provider Kobo”.', 'error'); }
      await refreshIntegrationPanel().catch(() => {});
    }
    setBusy(els.runLibrarySyncProbeBtn, false);
  }
}

async function copyLibrarySyncProbe() {
  const text = els.librarySyncProbeResult?.textContent || '';
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Diagnostic library_sync copié.'); }
  catch { toast('Impossible de copier le diagnostic.', 'error'); }
}

function downloadLibrarySyncProbe() {
  const text = els.librarySyncProbeResult?.textContent || '';
  if (!text) return;
  const blob = new Blob([text + '\n'], { type:'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kobo-vault-library-sync-probe-${dateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast('Diagnostic JSON téléchargé.');
}

async function refreshAllRatings() {
  if (!vault?.kobo?.accessToken) return toast('Connectez d’abord votre compte Kobo.', 'error');
  setBusy(els.refreshAllRatingsBtn,true,'Actualisation…');
  try {
    const stats=await enrichCommunityRatings(vault.purchases,{forceRefresh:true, includeRated:true});
    vault.updatedAt=new Date().toISOString(); await persistVault({remote:true});
    renderLibrary(); renderStats(); renderRatingDiagnosticOptions();
    const rated=(vault.purchases||[]).filter(b=>Number(b.averageRating)>0).length;
    toast(`Notes actualisées : ${rated}/${vault.purchases.length} livre(s) noté(s) · ${stats.enriched} enrichi(s).`);
  } catch(e) { toast(friendlyError(e),'error'); }
  finally { setBusy(els.refreshAllRatingsBtn,false); }
}

function renderStats() {
  if (!vault) return;
  const limit = Number(els.statsLimit.value || 20);
  let ranking = els.statsRanking.value || vault.settings?.statsRanking || 'count';
  const scopedBooks = filterPurchases(vault.purchases, { language: els.statsLanguage.value, mediaType: els.statsMedia.value });
  const ratedBooks = scopedBooks.filter(b => Number.isFinite(Number(b.averageRating)) && Number(b.averageRating) > 0);
  const weightedOption = els.statsRanking.querySelector('option[value="weighted"]');
  if (weightedOption) weightedOption.disabled = ratedBooks.length === 0;
  if (ranking === 'weighted' && ratedBooks.length === 0) { ranking = 'count'; els.statsRanking.value = 'count'; } else els.statsRanking.value = ranking;
  if (els.statsRatingStatus) els.statsRatingStatus.textContent = scopedBooks.length ? `Notes communautaires Kobo : ${ratedBooks.length}/${scopedBooks.length} livre(s) noté(s).` : '';
  const rows = topAuthors(vault.purchases, { language: els.statsLanguage.value, mediaType: els.statsMedia.value, limit, ranking });
  els.statsCount.textContent = String(rows.length);
  els.statsGrid.replaceChildren(...rows.map((row, index) => authorStatCard(row, index + 1, ranking)));
  els.statsEmpty.classList.toggle('hidden', rows.length > 0);
  updateFilterSummaries();
}


function authorStatCard(row, rank, ranking) {
  const article = document.createElement('article'); article.className = 'author-stat-card';
  const rankEl = document.createElement('span'); rankEl.className = 'author-rank'; rankEl.textContent = `#${rank}`;
  const content = document.createElement('div');
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'author-stat-link'; btn.textContent = row.name;
  btn.title = `Rapprocher ${row.name} avec le catalogue Kobo`; btn.addEventListener('click', () => openReconciliation('author', row.name));
  const count = document.createElement('p'); count.className = 'muted-text'; count.textContent = `${row.count} titre${row.count > 1 ? 's' : ''} acheté${row.count > 1 ? 's' : ''}`;
  content.append(btn, count);
  const rating = document.createElement('p'); rating.className = 'muted-text author-rating';
  if (row.ratedCount) {
    rating.textContent = `★ ${formatRating(row.averageRating)} moyenne · ${row.ratedCount}/${row.count} livre${row.count > 1 ? 's' : ''} noté${row.ratedCount > 1 ? 's' : ''} · score ${formatScore(row.weightedScore)}`;
  } else rating.textContent = 'Aucune note communautaire Kobo disponible';
  if (ranking === 'weighted') rating.classList.add('ranking-primary');
  content.append(rating); article.append(rankEl, content); return article;
}

function formatRating(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : '—'; }
function formatScore(value) { return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function startActivation() {
  setBusy(els.startActivationBtn, true, 'Initialisation…');
  try {
    const data = await api('/api/kobo/activation/start', { method: 'POST', body: {} });
    activation = data;
    els.activationCode.textContent = data.activationCode;
    els.activationLink.href = data.activationUrl || 'https://www.kobo.com/activate';
    els.activationBox.classList.remove('hidden');
    els.activationStatus.textContent = 'En attente de validation sur Kobo…';
    clearActivationTimer();
    activationTimer = setInterval(() => pollActivation(false), 4000);
    window.open(els.activationLink.href, '_blank', 'noopener,noreferrer');
  } catch (e) {
    toast(friendlyError(e), 'error');
  } finally { setBusy(els.startActivationBtn, false); }
}

async function pollActivation(manual) {
  if (!activation || activation.polling) return;
  activation.polling = true;
  if (manual) setBusy(els.pollActivationBtn, true, 'Vérification…');
  try {
    const data = await api('/api/kobo/activation/poll', {
      method: 'POST',
      body: {
        pollUrl: activation.pollUrl,
        deviceId: activation.deviceId,
        serialNumber: activation.serialNumber,
        appVersion: activation.appVersion
      }
    });
    if (data.status === 'complete') {
      clearActivationTimer();
      vault.kobo = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || '',
        userKey: data.userKey || '',
        userId: data.userId || '',
        deviceId: data.deviceId,
        serialNumber: data.serialNumber,
        appVersion: data.appVersion,
        connectedAt: new Date().toISOString()
      };
      vault.updatedAt = new Date().toISOString();
      activation = null;
      els.activationStatus.textContent = 'Compte connecté.';
      els.activationBox.classList.add('hidden');
      await persistVault({ remote: true });
      renderKobo();
      toast('Compte Kobo connecté.');
      selectTab('library');
    } else {
      els.activationStatus.textContent = `En attente… (${data.status || 'pending'})`;
    }
  } catch (e) {
    if (manual) toast(friendlyError(e), 'error');
    els.activationStatus.textContent = `Échec temporaire : ${friendlyError(e)}`;
  } finally {
    if (activation) activation.polling = false;
    if (manual) setBusy(els.pollActivationBtn, false);
  }
}

function clearActivationTimer() {
  if (activationTimer) clearInterval(activationTimer);
  activationTimer = null;
}

async function disconnectKobo() {
  if (!confirm('Oublier les jetons Kobo ? La liste déjà synchronisée restera dans le coffre et l’accès Provider Kobo sera désactivé.')) return;
  try {
    if (session) await api(`/api/v2/vault/${session.uidHash}/acquisition-access`, { method:'DELETE', headers:vaultHeaders(session.authSecret) });
  } catch {}
  vault.kobo = null;
  if (vault.settings) vault.settings.apiAcquisitionEnabled = false;
  vault.updatedAt = new Date().toISOString();
  await persistVault({ remote: true });
  renderKobo();
  toast('Jetons Kobo supprimés du coffre et accès d’acquisition désactivé.');
}


async function copySecret(field, successMessage) {
  const value = vault?.kobo?.[field];
  if (!value) return toast('Jeton indisponible.', 'error');
  try {
    await navigator.clipboard.writeText(value);
    toast(successMessage);
  } catch {
    const ta = document.createElement('textarea'); ta.value = value; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? successMessage : 'Impossible de copier le jeton.', ok ? 'success' : 'error');
  }
}

async function syncKoboLibrary() {
  if (!vault?.kobo?.accessToken) {
    selectTab('kobo');
    return toast('Connectez d’abord votre compte Kobo.', 'error');
  }
  setBusy(els.refreshLibraryBtn, true, 'Synchronisation…');
  try {
    const k = vault.kobo;
    const previous = new Map();
    for (const b of vault.purchases || []) {
      for (const key of [stableBookKey(b), b.productId && `p:${b.productId}`, b.isbn && `i:${b.isbn}`].filter(Boolean)) previous.set(key, b);
    }
    const data = await api('/api/kobo/library', {
      method: 'POST',
      body: { accessToken: k.accessToken, refreshToken: k.refreshToken, appVersion: k.appVersion }
    });
    if (data.auth) vault.kobo = { ...vault.kobo, ...data.auth };
    vault.purchases = (Array.isArray(data.purchases) ? data.purchases : []).map(book => {
      const old = previous.get(stableBookKey(book)) || (book.productId ? previous.get(`p:${book.productId}`) : null) || (book.isbn ? previous.get(`i:${book.isbn}`) : null);
      if (!old) return book;
      return { ...book, averageRating: book.averageRating ?? old.averageRating ?? null, ratingCount: book.ratingCount ?? old.ratingCount ?? null };
    });
    const ratings = await enrichCommunityRatings(vault.purchases);
    vault.purchasesFetchedAt = data.fetchedAt || new Date().toISOString();
    vault.updatedAt = new Date().toISOString();
    await persistVault({ remote: true });
    if (vault.settings?.apiProjectionEnabled) await publishProjection({ notify: false });
    if (vault.settings?.apiAcquisitionEnabled) await publishAcquisitionAccess({ notify: false });
    renderLibraryLanguageOptions(); renderLibrary(); renderStats(); renderKobo(); renderRatingDiagnosticOptions();
    const rated = vault.purchases.filter(b => Number.isFinite(Number(b.averageRating)) && Number(b.averageRating) > 0).length;
    toast(`${vault.purchases.length} acquisition(s) synchronisée(s) · ${rated} avec note Kobo${ratings.enriched ? ` · ${ratings.enriched} enrichie(s)` : ''}.`);
  } catch (e) {
    toast(friendlyError(e), 'error');
  } finally { setBusy(els.refreshLibraryBtn, false); }
}

async function enrichCommunityRatings(books, { forceRefresh = false, includeRated = false } = {}) {
  const all = (books || []).filter(b => b?.title || b?.isbn || b?.koboUrl || b?.productId);
  const candidates = includeRated ? all : all.filter(b => !(Number.isFinite(Number(b.averageRating)) && Number(b.averageRating) > 0));
  const stats = { attempted: candidates.length, enriched: 0, cacheHits: 0, failed: 0, sourceCounts: {} };
  if (!candidates.length) return stats;
  for (let offset = 0; offset < candidates.length; offset += RATING_BATCH_SIZE) {
    const chunk = candidates.slice(offset, offset + RATING_BATCH_SIZE);
    if (els.refreshLibraryBtn?.disabled) els.refreshLibraryBtn.textContent = `Notes Kobo… ${Math.min(offset + chunk.length, candidates.length)}/${candidates.length}`;
    try {
      const k=vault?.kobo||{};
      const data = await api('/api/kobo/ratings', { method: 'POST', body: {
        forceRefresh, accessToken:k.accessToken||'', refreshToken:k.refreshToken||'', appVersion:k.appVersion||'',
        books: chunk.map(b => ({ clientKey: ratingBookKey(b), productId: b.productId || '', revisionId:b.revisionId||'', isbn: b.isbn || '', title: b.title || '', authors: b.authors || [], language: b.language || '', mediaType:b.mediaType||'ebook', koboUrl: b.koboUrl || '' }))
      } });
      if(data.auth) vault.kobo={...vault.kobo,...data.auth};
      const byKey = new Map((data.items || []).map(x => [x.clientKey, x]));
      for (const book of chunk) {
        const rating = byKey.get(ratingBookKey(book)); if (!rating) continue;
        if (rating.averageRating != null) { if (Number(book.averageRating) !== Number(rating.averageRating)) stats.enriched += 1; book.averageRating = rating.averageRating; }
        if (rating.ratingCount != null) book.ratingCount = rating.ratingCount;
        if (rating.productUrl && !book.koboUrl) book.koboUrl = rating.productUrl;
        if (rating.cacheStatus === 'hit') stats.cacheHits += 1;
        stats.sourceCounts[rating.source||'none']=(stats.sourceCounts[rating.source||'none']||0)+1;
      }
      stats.failed += Number(data.failed || 0);
    } catch { stats.failed += chunk.length; }
  }
  return stats;
}

function ratingBookKey(book) { return String(book?.revisionId || book?.productId || book?.isbn || `${norm(book?.title)}|${norm(book?.authors?.[0] || '')}`); }


async function searchCatalog(event) {
  event.preventDefault();
  const mode = els.catalogMode.value || 'author';
  const query = els.catalogQuery.value.trim();
  const language = els.catalogLanguage.value;
  if (!query) return;
  const forceRefresh = catalogForceRefresh;
  catalogForceRefresh = false;
  const key = catalogCacheKey(mode, query, language);
  const cached = await getCatalogCache(session.uidHash, key).catch(() => null);
  if (!forceRefresh && cached?.items?.length && cacheIsFresh(cached)) {
    const allItems = dedupe(cached.items);
    const comparison = compareCatalog(vault.purchases, allItems, { mode, query, language }, vault.bookStates);
    catalogFilter = 'all';
    const data = { ...(cached.data || {}), cacheSource: 'local', fetchedAt: cached.fetchedAt };
    currentCatalog = { mode, query, language, items: allItems, comparison, data };
    history.replaceState({ tab: 'catalog', ...catalogFormState() }, '', location.href);
    renderCatalogComparison(comparison, data);
    return;
  }
  if (!vault?.kobo?.accessToken) {
    selectTab('kobo');
    return toast(cached ? 'Le cache catalogue est expiré. Reconnectez Kobo ou relancez avec une connexion active.' : 'Connectez d’abord votre compte Kobo.', 'error');
  }
  const submit = els.catalogForm.querySelector('button[type="submit"]');
  setBusy(submit, true, forceRefresh ? 'Actualisation…' : 'Recherche…');
  showMessage(els.catalogStatus, forceRefresh ? 'Actualisation forcée depuis Kobo…' : 'Interrogation du catalogue Kobo…', 'info');
  try {
    let k = { ...vault.kobo };
    let pageIndex = 0;
    let totalPages = 1;
    const maxPages = 10;
    let lastData = {};
    let cloudCacheHits = 0;
    let cloudCacheMisses = 0;
    let authUpdated = false;
    const catalogItems = [];
    do {
      const data = await api('/api/kobo/catalog', {
        method: 'POST',
        body: { query, language, pageSize: 100, pageIndex, forceRefresh, accessToken: k.accessToken, refreshToken: k.refreshToken, appVersion: k.appVersion }
      });
      lastData = data;
      catalogItems.push(...(data.items || []));
      if (data.cacheStatus === 'hit') cloudCacheHits += 1; else cloudCacheMisses += 1;
      if (data.auth) { k = { ...k, ...data.auth }; vault.kobo = { ...vault.kobo, ...data.auth }; authUpdated = true; }
      const announced = Number(data.rawPageInfo?.totalPageCount);
      totalPages = Number.isFinite(announced) && announced > 0 ? announced : 1;
      pageIndex += 1;
      if (pageIndex < Math.min(totalPages, maxPages)) showMessage(els.catalogStatus, `Catalogue Kobo : page ${pageIndex + 1}/${Math.min(totalPages, maxPages)}…`, 'info');
    } while (pageIndex < Math.min(totalPages, maxPages));
    const allItems = dedupe(catalogItems);
    const comparison = compareCatalog(vault.purchases, allItems, { mode, query, language }, vault.bookStates);
    const data = { ...lastData, pagesScanned: pageIndex, announcedPages: totalPages, truncated: totalPages > maxPages, cloudCacheHits, cloudCacheMisses, cacheSource: 'network' };
    // Cache catalogue public : IndexedDB local uniquement. Ne jamais l'envoyer dans le coffre/D1.
    const cacheData = { pagesScanned: pageIndex, announcedPages: totalPages, truncated: totalPages > maxPages, cloudCacheHits, cloudCacheMisses };
    const cacheResult = await putCatalogCache(session.uidHash, key, {
      mode, query, language, fetchedAt: new Date().toISOString(), items: allItems, data: cacheData
    }).catch(() => ({ stored: false, reason: 'storage_error' }));
    if (!cacheResult?.stored) await deleteCatalogCache(session.uidHash, key).catch(() => {});
    // Une recherche catalogue ne modifie plus le coffre. Seul un éventuel refresh de token Kobo doit être synchronisé.
    if (authUpdated) await persistVault({ remote: true });
    catalogFilter = 'all';
    currentCatalog = { mode, query, language, items: allItems, comparison, data };
    history.replaceState({ tab: 'catalog', ...catalogFormState() }, '', location.href);
    renderCatalogComparison(comparison, data);
  } catch (e) {
    showMessage(els.catalogStatus, friendlyError(e), 'error');
    els.catalogGrid.replaceChildren();
    els.compareStats.replaceChildren();
    els.catalogEmpty.classList.remove('hidden');
  } finally { setBusy(submit, false); }
}

function catalogCacheKey(mode, query, language) { const q = String(query || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}"]+/gu, ' ').replace(/\s+/g, ' ').trim(); return `${mode}|${q}|${String(language || '').toLowerCase()}`; }

function cacheIsFresh(entry) { const t = Date.parse(entry?.fetchedAt || 0); return Number.isFinite(t) && Date.now() - t < CATALOG_LOCAL_TTL_MS; }

function renderCatalogComparison(c, data, { preserveStatus = false } = {}) {
  if (!c) return;
  els.compareStats.replaceChildren(
    stat(String(c.catalog.length), 'Tous les titres', 'all'),
    stat(String(c.ownedCount), 'Possédés', 'owned'),
    stat(String(c.readCount || 0), 'Lus / déjà connus', 'read'),
    stat(String(c.missingCount ?? c.missing.length), 'Potentiellement manquants', 'missing')
  );
  renderCatalogFilter(c);
  if (!preserveStatus) {
    if (data?.cacheSource === 'local') {
      showMessage(els.catalogStatus, `${c.catalog.length} titre(s) depuis le cache local du ${formatDate(data.fetchedAt)}. ${c.missingCount ?? c.missing.length} potentiellement manquant(s). Utilisez « Actualiser Kobo » pour ignorer le cache.`, 'info');
      return;
    }
    const scope = c.mode === 'author' ? 'titre(s) attribué(s) à cet auteur' : c.mode === 'series' ? 'titre(s) de cette série / collection' : 'résultat(s) Kobo rapproché(s)';
    showMessage(
      els.catalogStatus,
      `${c.catalog.length} ${scope} : ${c.ownedCount} possédé(s), ${c.readCount || 0} marqué(s) lu(s), ${c.missingCount ?? c.missing.length} potentiellement manquant(s).`,
      'info'
    );
    if (data?.pagesScanned > 1) els.catalogStatus.textContent += ` ${data.pagesScanned} page(s) du catalogue analysée(s).`;
    if (data?.cloudCacheHits) els.catalogStatus.textContent += ` ${data.cloudCacheHits} page(s) servie(s) par le cache Cloudflare.`;
    if (data?.truncated) els.catalogStatus.textContent += ` Recherche limitée aux 10 premières pages sur ${data.announcedPages}.`;
  }
}

function renderCatalogFilter(c) {
  const items = sortBooks(filterComparison(c, catalogFilter), els.catalogSort.value);
  const nodes = items.map(book => {
    const status = c.owned.includes(book) ? 'owned' : c.read.includes(book) ? 'read' : 'missing';
    return bookCard(book, { status });
  });
  els.catalogGrid.replaceChildren(...nodes);
  els.catalogEmpty.classList.toggle('hidden', items.length > 0);
  if (!items.length) els.catalogEmpty.textContent = `Aucun titre dans le filtre « ${catalogFilterLabel(catalogFilter)} ».`;
  document.querySelectorAll('#compareStats .stat').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === catalogFilter));
}

function stat(value, label, filter) {
  const d = document.createElement('button'); d.className = 'stat'; d.type = 'button'; d.dataset.filter = filter;
  const strong = document.createElement('strong'); strong.textContent = value;
  const span = document.createElement('span'); span.textContent = label;
  d.append(strong, span);
  d.addEventListener('click', () => { catalogFilter = filter; if (currentCatalog) renderCatalogFilter(currentCatalog.comparison); });
  return d;
}

function catalogFilterLabel(filter) {
  return ({ all: 'Tous', owned: 'Possédés', read: 'Lus / déjà connus', missing: 'Potentiellement manquants' })[filter] || 'Tous';
}

async function persistVault(options = {}) {
  const opts = { remote: true, retryConflict: true, ...options };
  saveChain = saveChain.catch(() => {}).then(() => persistVaultImpl(opts));
  return saveChain;
}

async function persistVaultImpl({ remote, retryConflict }) {
  if (!session || !vault) return;
  vault.updatedAt = new Date().toISOString();
  let blob = await encryptVault(vault, session.encKey, session.uidHash);
  await putLocalVault({ uidHash: session.uidHash, salt: session.salt, blob, version: session.version, updatedAt: vault.updatedAt });
  if (session.remembered && session.rememberMaterial) await rememberCurrentSession();
  if (!remote || session.offline || !navigator.onLine) {
    setSyncBadge('Local uniquement', 'warn');
    return;
  }
  setSyncBadge('Synchronisation…', 'muted');
  try {
    const result = await api(`/api/vault/${session.uidHash}`, {
      method: 'PUT', headers: vaultHeaders(session.authSecret),
      body: { salt: session.salt, blob, expectedVersion: session.version }
    });
    session.version = Number(result.version || session.version);
    session.remoteUpdatedAt = result.updatedAt || new Date().toISOString();
    session.offline = false;
    await putLocalVault({ uidHash: session.uidHash, salt: session.salt, blob, version: session.version, updatedAt: session.remoteUpdatedAt });
    setSyncBadge('Synchronisé', 'ok');
    renderSettings();
  } catch (e) {
    if (e.status === 409 && e.data?.error === 'version_conflict' && retryConflict) {
      const remoteData = await api(`/api/vault/${session.uidHash}`, { headers: vaultHeaders(session.authSecret) });
      const remoteVault = normalizeVault(await decryptVault(remoteData.blob, session.encKey, session.uidHash));
      vault = normalizeVault(mergeVaults(remoteVault, vault));
      session.version = Number(remoteData.version || 0);
      session.remoteUpdatedAt = remoteData.updatedAt || session.remoteUpdatedAt;
      return persistVaultImpl({ remote: true, retryConflict: false });
    }
    setSyncBadge('Non synchronisé', 'warn');
    throw e;
  }
}

async function syncVaultNow() {
  if (!session) return;
  setBusy(els.syncNowBtn, true, 'Synchronisation…');
  try {
    const meta = await api(`/api/vault/${session.uidHash}/meta`);
    if (meta.exists) {
      const remote = await api(`/api/vault/${session.uidHash}`, { headers: vaultHeaders(session.authSecret) });
      const remoteVault = normalizeVault(await decryptVault(remote.blob, session.encKey, session.uidHash));
      if (Number(remote.version || 0) !== session.version) {
        vault = normalizeVault(mergeVaults(remoteVault, vault));
        session.version = Number(remote.version || 0);
        session.remoteUpdatedAt = remote.updatedAt || null;
      }
    } else {
      session.version = 0;
    }
    session.offline = false;
    await persistVault({ remote: true });
    if (vault.settings?.apiProjectionEnabled) await publishProjection({ notify: false });
    if (vault.settings?.apiAcquisitionEnabled) await publishAcquisitionAccess({ notify: false });
    renderAll();
    toast('Coffre synchronisé.');
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(els.syncNowBtn, false); }
}

function exportCsv() {
  download(`kobo-library-${dateStamp()}.csv`, '\ufeff' + toCsv(vault?.purchases || []), 'text/csv;charset=utf-8');
}
function exportJson() {
  const safe = { schema: vault.schema, exportedAt: new Date().toISOString(), purchases: vault.purchases, purchasesFetchedAt: vault.purchasesFetchedAt, bookStates: vault.bookStates || {} };
  download(`kobo-library-${dateStamp()}.json`, JSON.stringify(safe, null, 2), 'application/json');
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function removeVault() {
  if (!session) return;
  if (!confirm(`Supprimer définitivement le coffre « ${session.uid} » sur Cloudflare et cet appareil ?`)) return;
  setBusy(els.deleteVaultBtn, true, 'Suppression…');
  try {
    const meta = await api(`/api/vault/${session.uidHash}/meta`);
    if (meta.exists) await api(`/api/vault/${session.uidHash}`, { method: 'DELETE', headers: vaultHeaders(session.authSecret) });
    await deleteLocalVault(session.uidHash);
    await deleteCatalogCaches(session.uidHash).catch(() => {});
    forgetKnownProfile(session.uid);
    clearLastUid();
    await lock({ forgetRemembered: true });
    renderProfileSelectors();
    els.uidInput.value = '';
    toast('Coffre supprimé.');
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally { setBusy(els.deleteVaultBtn, false); }
}


async function refreshPwaDiagnostics() {
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  if (els.pwaMode) els.pwaMode.textContent = standalone ? 'Application installée / standalone' : 'Navigateur';
  if (els.pwaManifest) {
    try {
      const r = await fetch('/manifest.webmanifest', { cache: 'no-store' });
      const m = r.ok ? await r.json() : null;
      const iconSizes = new Set((m?.icons || []).flatMap(i => String(i.sizes || '').split(/\s+/)));
      els.pwaManifest.textContent = r.ok && m?.display && iconSizes.has('192x192') && iconSizes.has('512x512') ? 'OK · icônes 192/512' : 'Incomplet';
    } catch { els.pwaManifest.textContent = 'Indisponible'; }
  }
  if (els.pwaServiceWorker) {
    try {
      swRegistration ||= await navigator.serviceWorker?.getRegistration?.('/');
      const state = swRegistration?.active?.state || swRegistration?.installing?.state || swRegistration?.waiting?.state;
      els.pwaServiceWorker.textContent = state ? `Actif · ${state}` : (navigator.serviceWorker ? 'Enregistré, activation en attente' : 'Non supporté');
    } catch { els.pwaServiceWorker.textContent = 'Indisponible'; }
  }
  if (els.pwaStorage) {
    try {
      const persisted = await navigator.storage?.persisted?.();
      const estimate = await navigator.storage?.estimate?.();
      const used = estimate?.usage ? ` · ${formatBytes(estimate.usage)}` : '';
      els.pwaStorage.textContent = persisted === true ? `Oui${used}` : persisted === false ? `Non garanti${used}` : `Inconnu${used}`;
    } catch { els.pwaStorage.textContent = 'Indisponible'; }
  }
  updateInstallUi();
}

function updateInstallUi() {
  if (!els.installAppBtn || !els.pwaInstallHelp) return;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  els.installAppBtn.classList.toggle('hidden', standalone || !deferredInstallPrompt);
  if (standalone) { els.pwaInstallHelp.textContent = 'L’application fonctionne déjà en mode standalone.'; return; }
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua) && /Firefox\//i.test(ua)) els.pwaInstallHelp.textContent = 'Firefox Android : ouvrez le menu ⋮ puis choisissez « Installer » / « Ajouter l’app à l’écran d’accueil » si proposé.';
  else if (deferredInstallPrompt) els.pwaInstallHelp.textContent = 'Le navigateur indique que cette webapp peut être installée.';
  else els.pwaInstallHelp.textContent = 'Si aucun bouton d’installation n’apparaît, utilisez la commande Installer / Ajouter à l’écran d’accueil du menu du navigateur.';
}

async function installPwa() {
  if (!deferredInstallPrompt) { updateInstallUi(); return; }
  const prompt = deferredInstallPrompt; deferredInstallPrompt = null;
  try { await prompt.prompt(); await prompt.userChoice; } catch {}
  await refreshPwaDiagnostics();
}

function formatBytes(bytes) {
  const n = Number(bytes || 0); if (!n) return '0 o';
  const units = ['o','Ko','Mo','Go']; let v = n, i = 0; while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function api(path, { method = 'GET', headers = {}, body } = {}) {
  const h = new Headers(headers);
  h.set('Accept', 'application/json');
  const init = { method, headers: h };
  if (body !== undefined) { h.set('Content-Type', 'application/json'); init.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(path, init); }
  catch { const e = new Error('Réseau indisponible'); e.code = 'network_error'; throw e; }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const nested = data?.error && typeof data.error === 'object' ? data.error : null;
    const e = new Error(nested?.message || data.message || `Erreur HTTP ${response.status}`);
    e.status = response.status; e.code = nested?.code || data.error || 'http_error'; e.data = data;
    throw e;
  }
  return data;
}

function vaultHeaders(authSecret) { return { 'X-Vault-Auth': authSecret }; }
function setBusy(button, busy, busyText = 'Traitement…') {
  if (!button) return;
  if (busy) { button.dataset.label = button.textContent; button.textContent = busyText; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; delete button.dataset.label; }
}
function showMessage(el, text, type = 'info') {
  el.textContent = text; el.className = `message ${type}`; el.classList.remove('hidden');
}
function setSyncBadge(text, kind = 'muted') { els.syncBadge.textContent = text; els.syncBadge.className = `badge ${kind}`; }
function toast(text, type = 'success') {
  clearTimeout(toastTimer); els.toast.textContent = text; els.toast.className = `toast ${type}`; els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 4500);
}
function option(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }
function languageLabel(v) {
  if (!v) return '';
  const code = String(v).split(/[-_]/)[0].toLowerCase();
  try { return new Intl.DisplayNames(['fr'], { type: 'language' }).of(code) || v; } catch { return v; }
}
function formatDate(v) {
  const d = new Date(v); if (Number.isNaN(d.getTime())) return String(v || '—');
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
function dateStamp() { return new Date().toISOString().slice(0,10); }
function friendlyError(e) {
  const known = {
    invalid_credentials: 'UID ou mot de passe incorrect.',
    kobo_refresh_failed: 'Le jeton Kobo a expiré. Reconnectez le compte Kobo.',
    kobo_initialization_failed: 'Kobo refuse actuellement l’initialisation. Reconnectez le compte ou réessayez plus tard.',
    activation_parse_failed: 'Le format de la page d’activation Kobo a changé : une adaptation du connecteur est nécessaire.',
    kobo_catalog_failed: 'La recherche catalogue Kobo a échoué. Cet endpoint non documenté peut avoir changé.',
    network_error: 'Réseau indisponible.'
  };
  return known[e?.code] || e?.message || 'Erreur inattendue.';
}
