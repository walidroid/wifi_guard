'use strict';

(function () {
  if (!window.guardianApi) {
    const sseListeners = new Set();
    let eventSource = null;

    function initSse() {
      if (eventSource) return;
      try {
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            sseListeners.forEach((fn) => {
              try { fn(data); } catch (_) {}
            });
          } catch (_) {}
        };
        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
            setTimeout(initSse, 4000);
          }
        };
      } catch (_) {}
    }
    initSse();

    window.guardianApi = {
      getStatus: () => fetch('/api/status').then((r) => r.json()),
      getNetworks: (interfaceGuid) =>
        fetch('/api/networks?interfaceGuid=' + encodeURIComponent(interfaceGuid || '')).then((r) => r.json()),
      importProfileXml: async () => {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.xml';
          input.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return resolve({ success: false, canceled: true });
            const xmlContent = await file.text();
            try {
              const res = await fetch('/api/profile-xml', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ xmlContent })
              }).then((r) => r.json());
              resolve(res);
            } catch (err) {
              resolve({ success: false, code: 'FETCH_ERROR', messageFr: err.message, messageEn: err.message });
            }
          };
          input.click();
        });
      },
      enableProtection: (payload) =>
        fetch('/api/protection/enable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then((r) => r.json()),
      disableProtection: () =>
        fetch('/api/protection/disable', { method: 'POST' }).then((r) => r.json()),
      restoreBackup: (fileName) =>
        fetch('/api/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName })
        }).then((r) => r.json()),
      createBackup: () =>
        fetch('/api/backup', { method: 'POST' }).then((r) => r.json()),
      listBackups: () =>
        fetch('/api/backups').then((r) => r.json()),
      updateConfig: (partial) =>
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial)
        }).then((r) => r.json()),
      requestElevation: () =>
        Promise.resolve({ success: false, messageFr: 'Veuillez lancer l’application en tant qu’Administrateur.', messageEn: 'Please run the application as Administrator.' }),
      getLogsAndEvents: () =>
        fetch('/api/logs').then((r) => r.json()),
      getSystemInfo: () =>
        fetch('/api/sysinfo').then((r) => r.json()),
      onWlanEvent: (callback) => {
        if (typeof callback !== 'function') return () => {};
        sseListeners.add(callback);
        return () => sseListeners.delete(callback);
      }
    };
  }

  const api = window.guardianApi;
  let currentLang = 'fr';
  let currentTheme = 'dark';
  let latestStatus = null;

  function t(key) {
    const dict = window.GUARDIAN_I18N[currentLang] || window.GUARDIAN_I18N.fr;
    return dict[key] || key;
  }

  function applyTranslations() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });
    const themeLabel = document.getElementById('themeBtnLabel');
    if (themeLabel) {
      themeLabel.textContent = currentTheme === 'dark' ? t('themeLight') : t('themeDark');
    }
    if (latestStatus) {
      renderStatus(latestStatus);
    }
  }

  function setTheme(theme) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    applyTranslations();
  }

  function showToast(message, isError = false) {
    const banner = document.getElementById('toastBanner');
    if (!banner) return;
    banner.textContent = message;
    banner.className = `toast-banner show ${isError ? 'error' : 'info'}`;
    setTimeout(() => {
      banner.classList.remove('show');
    }, 6000);
  }

  function renderStatus(status) {
    latestStatus = status;

    // 1. Admin / UAC Badge
    const adminBadge = document.getElementById('adminBadge');
    const adminBadgeText = document.getElementById('adminBadgeText');
    const btnElevate = document.getElementById('btnElevateUac');
    if (status.isAdmin) {
      adminBadge.className = 'privilege-badge admin';
      adminBadgeText.textContent = t('adminBadgeElevated');
      btnElevate.style.display = 'none';
    } else {
      adminBadge.className = 'privilege-badge standard';
      adminBadgeText.textContent = t('adminBadgeStandard');
      btnElevate.style.display = 'inline-flex';
    }

    // 2. Overall Protection Indicator (Green / Orange / Red / Gray)
    const pill = document.getElementById('protectionStatusPill');
    const pillText = document.getElementById('protectionStatusText');
    const stateMap = {
      protected: { cls: 'protected', label: t('statusProtected') },
      partial: { cls: 'partial', label: t('statusPartial') },
      unprotected: { cls: 'unprotected', label: t('statusUnprotected') },
      unknown: { cls: 'unknown', label: t('statusUnknown') }
    };
    const mapped = stateMap[status.protectionStatus] || stateMap.unknown;
    pill.className = `status-pill ${mapped.cls}`;
    pillText.textContent = mapped.label;

    const iface = status.primaryInterface;
    const cfgLab = (status.config && status.config.labNetwork) || {};

    // 3. Dashboard Cards
    document.getElementById('heroSsidTitle').textContent = cfgLab.ssid
      ? `${t('appTitle')} — SSID : ${cfgLab.ssid}`
      : t('appTitle');

    document.getElementById('dashConnState').textContent = !status.wlanServiceRunning
      ? t('msgWlanUnavailable')
      : iface
      ? iface.connected
        ? currentLang === 'fr'
          ? 'Connecté'
          : 'Connected'
        : currentLang === 'fr'
        ? `Déconnecté (${iface.state})`
        : `Disconnected (${iface.state})`
      : t('msgAdapterNotFound');

    document.getElementById('dashSignal').textContent =
      iface && iface.connected
        ? `Signal : ${iface.signalQuality}%`
        : status.disconnectDiagnosis
        ? currentLang === 'fr'
          ? status.disconnectDiagnosis.fr
          : status.disconnectDiagnosis.en
        : '—';

    document.getElementById('dashConnectedSsid').textContent =
      iface && iface.connectedSsid ? iface.connectedSsid : '—';
    document.getElementById('dashAllowedSsid').textContent = cfgLab.ssid
      ? `${currentLang === 'fr' ? 'SSID autorisé' : 'Allowed SSID'} : ${cfgLab.ssid}`
      : currentLang === 'fr'
      ? 'Aucun filtre SSID actif'
      : 'No active SSID filter';

    document.getElementById('dashAdapterName').textContent = iface
      ? iface.description
      : t('msgAdapterNotFound');
    document.getElementById('dashAdapterGuid').textContent = iface ? iface.guid : '—';

    document.getElementById('dashRadioState').textContent = iface
      ? `SW: ${iface.softwareRadioState.toUpperCase()} | HW: ${iface.hardwareRadioState.toUpperCase()}`
      : '—';
    document.getElementById('dashAutoconfState').textContent = iface
      ? `AutoConfig : ${iface.autoconfEnabled ? 'ON' : 'OFF'}`
      : '—';

    document.getElementById('dashAirplaneState').textContent = status.airplaneModeEnabled
      ? `✈️ ${t('msgAirplaneDetected')}`
      : currentLang === 'fr'
      ? 'Désactivé (Radio normale)'
      : 'Off (Normal radio operation)';

    document.getElementById('dashShowDeniedState').textContent = !status.showDeniedNetworks
      ? currentLang === 'fr'
        ? 'Réseaux bloqués masqués'
        : 'Blocked networks hidden'
      : currentLang === 'fr'
      ? 'Réseaux bloqués visibles'
      : 'Blocked networks visible';

    document.getElementById('dashLastUpdated').textContent = status.lastUpdated
      ? new Date(status.lastUpdated).toLocaleString(currentLang === 'fr' ? 'fr-FR' : 'en-US')
      : '—';

    document.getElementById('dashDisconnectReason').textContent = status.disconnectDiagnosis
      ? currentLang === 'fr'
        ? status.disconnectDiagnosis.fr
        : status.disconnectDiagnosis.en
      : currentLang === 'fr'
      ? 'Aucune anomalie détectée'
      : 'No anomaly detected';

    // Populate adapter select and config inputs if empty
    const adapterSelect = document.getElementById('cfgAdapterSelect');
    if (adapterSelect && Array.isArray(status.interfaces)) {
      adapterSelect.innerHTML = '';
      status.interfaces.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.guid;
        opt.textContent = `${item.description} (${item.state})`;
        if (item.guid === cfgLab.interfaceGuid) opt.selected = true;
        adapterSelect.appendChild(opt);
      });
    }

    const ssidInput = document.getElementById('cfgSsidInput');
    const profInput = document.getElementById('cfgProfileInput');
    if (ssidInput && !ssidInput.value && (cfgLab.ssid || (iface && iface.connectedSsid))) {
      ssidInput.value = cfgLab.ssid || iface.connectedSsid;
    }
    if (
      profInput &&
      !profInput.value &&
      (cfgLab.profileName || (iface && iface.connectedProfileName))
    ) {
      profInput.value = cfgLab.profileName || iface.connectedProfileName;
    }

    if (status.config && status.config.restrictions) {
      const r = status.config.restrictions;
      document.getElementById('chkLockUserProfiles').checked = Boolean(
        r.lockPerUserProfileCreation
      );
      document.getElementById('chkAutoRestoreRadio').checked =
        r.autoReEnableSoftwareRadio !== false;
      document.getElementById('chkHideWifiPage').checked =
        r.hideWindowsWifiSettingsPage !== false;
      document.getElementById('chkHideAirplanePage').checked =
        r.hideWindowsAirplaneSettingsPage !== false;
      document.getElementById('chkNoNetSetup').checked = r.restrictNoNetSetupFlag !== false;
    }
  }

  async function refreshAll() {
    const status = await api.getStatus();
    if (status.config && status.config.language && status.config.language !== currentLang) {
      currentLang = status.config.language;
      document.getElementById('langSelect').value = currentLang;
    }
    if (status.config && status.config.theme && status.config.theme !== currentTheme) {
      setTheme(status.config.theme);
    }
    renderStatus(status);
    await refreshNetworksTable();
  }

  async function refreshNetworksTable() {
    const guid = document.getElementById('cfgAdapterSelect').value || '';
    const netData = await api.getNetworks(guid);
    const tbody = document.getElementById('networksTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = netData.availableNetworks || [];
    if (list.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent =
        currentLang === 'fr'
          ? 'Aucun réseau Wi-Fi détecté ou service WLAN non disponible.'
          : 'No Wi-Fi networks detected or WLAN service unavailable.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach((net) => {
      const tr = document.createElement('tr');

      const tdSsid = document.createElement('td');
      tdSsid.style.fontWeight = '600';
      tdSsid.textContent = net.ssid;

      const tdProf = document.createElement('td');
      tdProf.textContent = net.profileName || '—';

      const tdSig = document.createElement('td');
      tdSig.textContent = `${net.signalQuality}%`;

      const tdSec = document.createElement('td');
      tdSec.textContent = net.securityEnabled ? 'WPA2/WPA3' : 'Open';

      const tdState = document.createElement('td');
      tdState.textContent = net.connected
        ? currentLang === 'fr'
          ? 'Connecté'
          : 'Connected'
        : currentLang === 'fr'
        ? 'Disponible'
        : 'Available';

      const tdAct = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.padding = '4px 10px';
      btn.style.fontSize = '12px';
      btn.textContent = t('btnSelectSsid');
      btn.addEventListener('click', () => {
        document.getElementById('cfgSsidInput').value = net.ssid;
        document.getElementById('cfgProfileInput').value = net.profileName || net.ssid;
        showToast(
          currentLang === 'fr'
            ? `SSID "${net.ssid}" sélectionné comme réseau du laboratoire.`
            : `SSID "${net.ssid}" selected as laboratory network.`
        );
      });
      tdAct.appendChild(btn);

      tr.append(tdSsid, tdProf, tdSig, tdSec, tdState, tdAct);
      tbody.appendChild(tr);
    });
  }

  async function refreshMonitoringView() {
    const data = await api.getLogsAndEvents();
    const eventsBody = document.getElementById('eventsTableBody');
    const logsBody = document.getElementById('logsTableBody');

    if (eventsBody) {
      eventsBody.innerHTML = '';
      (data.events || []).slice(0, 40).forEach((evt) => {
        const tr = document.createElement('tr');
        const tdTime = document.createElement('td');
        tdTime.textContent = new Date(evt.timestamp).toLocaleTimeString();
        const tdSrc = document.createElement('td');
        tdSrc.textContent = evt.source;
        const tdCode = document.createElement('td');
        tdCode.textContent = evt.codeName;
        const tdDesc = document.createElement('td');
        tdDesc.textContent = currentLang === 'fr' ? evt.descriptionFr : evt.descriptionEn;
        tr.append(tdTime, tdSrc, tdCode, tdDesc);
        eventsBody.appendChild(tr);
      });
    }

    if (logsBody) {
      logsBody.innerHTML = '';
      (data.logs || []).slice(0, 50).forEach((entry) => {
        const tr = document.createElement('tr');
        const tdTime = document.createElement('td');
        tdTime.textContent = new Date(entry.timestamp).toLocaleTimeString();
        const tdLvl = document.createElement('td');
        tdLvl.textContent = entry.level;
        const tdCode = document.createElement('td');
        tdCode.textContent = entry.code;
        const tdMsg = document.createElement('td');
        tdMsg.textContent = currentLang === 'fr' ? entry.messageFr : entry.messageEn;
        tr.append(tdTime, tdLvl, tdCode, tdMsg);
        logsBody.appendChild(tr);
      });
    }
  }

  async function refreshBackupsView() {
    const list = await api.listBackups();
    const tbody = document.getElementById('backupsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!list || list.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent =
        currentLang === 'fr'
          ? 'Aucune sauvegarde enregistrée pour le moment.'
          : 'No backup snapshots saved yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach((item) => {
      const tr = document.createElement('tr');
      const tdDate = document.createElement('td');
      tdDate.textContent = new Date(item.createdAt).toLocaleString();
      const tdFile = document.createElement('td');
      tdFile.textContent = item.fileName;
      const tdType = document.createElement('td');
      tdType.textContent = item.isBaseline
        ? currentLang === 'fr'
          ? 'Référence originale (Baseline)'
          : 'Original Baseline'
        : item.reason;
      const tdDetails = document.createElement('td');
      tdDetails.textContent = `Profils: ${item.profilesCount} | Allow: ${item.allowFilterCount} | Deny: ${item.denyFilterCount}`;

      const tdAct = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn btn-warning';
      btn.style.padding = '4px 10px';
      btn.style.fontSize = '12px';
      btn.textContent = t('btnRestoreThis');
      btn.addEventListener('click', async () => {
        const res = await api.restoreBackup(item.fileName);
        showToast(
          currentLang === 'fr' ? res.messageFr : res.messageEn,
          !res.success
        );
        if (res.status) renderStatus(res.status);
        await refreshBackupsView();
      });
      tdAct.appendChild(btn);

      tr.append(tdDate, tdFile, tdType, tdDetails, tdAct);
      tbody.appendChild(tr);
    });
  }

  async function refreshSysInfoView() {
    const info = await api.getSystemInfo();
    const tbody = document.getElementById('sysInfoTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = [
      ['Application', `${info.appName} v${info.appVersion}`],
      ['OS / Architecture', `${info.osType} (${info.platform} / ${info.arch}) — Release ${info.osRelease}`],
      ['Nom d’hôte / Hostname', info.hostname],
      [
        'Privilèges Windows UAC',
        info.isAdmin ? t('adminBadgeElevated') : t('adminBadgeStandard')
      ],
      [
        'Module Natif C++ (wlan_native.node)',
        info.nativeAddonLoaded
          ? `Chargé / Loaded (${info.nativeBinaryPath})`
          : 'Non chargé (Compilation Windows x64 requise)'
      ],
      ['Runtime Electron / Node.js', `Electron ${info.electronVersion} | Node ${info.nodeVersion}`],
      ['Répertoire de données (%APPDATA%)', info.userDataPath],
      ['Exécutable portable', info.exePath]
    ];

    rows.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.style.width = '32%';
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(th, td);
      tbody.appendChild(tr);
    });
  }

  function buildProtectionPayloadFromUi() {
    return {
      interfaceGuid: document.getElementById('cfgAdapterSelect').value || '',
      ssid: document.getElementById('cfgSsidInput').value.trim(),
      profileName: document.getElementById('cfgProfileInput').value.trim(),
      autoConnect: document.getElementById('chkAutoConnect').checked,
      reconnectOnDisconnect: document.getElementById('chkReconnect').checked,
      hideBlockedNetworks: document.getElementById('chkHideBlocked').checked,
      blockAdhocNetworks: document.getElementById('chkBlockAdhoc').checked,
      restrictions: {
        lockPerUserProfileCreation: document.getElementById('chkLockUserProfiles').checked,
        autoReEnableSoftwareRadio: document.getElementById('chkAutoRestoreRadio').checked,
        hideWindowsWifiSettingsPage: document.getElementById('chkHideWifiPage').checked,
        hideWindowsAirplaneSettingsPage: document.getElementById('chkHideAirplanePage').checked,
        restrictNoNetSetupFlag: document.getElementById('chkNoNetSetup').checked
      }
    };
  }

  // Wire UI Events
  window.addEventListener('DOMContentLoaded', () => {
    // Sidebar tab switching
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
        document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
        item.classList.add('active');
        const viewId = item.getAttribute('data-view');
        const panel = document.getElementById(`view-${viewId}`);
        if (panel) panel.classList.add('active');

        if (viewId === 'wifi-config') refreshNetworksTable();
        if (viewId === 'monitoring') refreshMonitoringView();
        if (viewId === 'backup') refreshBackupsView();
        if (viewId === 'sysinfo') refreshSysInfoView();
      });
    });

    // Language selector
    document.getElementById('langSelect').addEventListener('change', async (e) => {
      currentLang = e.target.value === 'en' ? 'en' : 'fr';
      applyTranslations();
      await api.updateConfig({ language: currentLang });
    });

    // Theme toggle
    document.getElementById('btnToggleTheme').addEventListener('click', async () => {
      const next = currentTheme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      await api.updateConfig({ theme: next });
    });

    // UAC Elevation button
    document.getElementById('btnElevateUac').addEventListener('click', async () => {
      const res = await api.requestElevation();
      if (!res.success) {
        showToast(res.errorMessage || t('msgAdminRequired'), true);
      }
    });

    // Main Dashboard Controls
    document.getElementById('btnEnableProtection').addEventListener('click', async () => {
      const payload = buildProtectionPayloadFromUi();
      const res = await api.enableProtection(payload);
      showToast(
        currentLang === 'fr' ? res.messageFr : res.messageEn,
        !res.success
      );
      if (res.status) renderStatus(res.status);
    });

    document.getElementById('btnDisableProtection').addEventListener('click', async () => {
      const res = await api.disableProtection();
      showToast(
        currentLang === 'fr' ? res.messageFr : res.messageEn,
        !res.success
      );
      if (res.status) renderStatus(res.status);
    });

    document.getElementById('btnRestoreOriginal').addEventListener('click', async () => {
      const res = await api.restoreBackup(null);
      showToast(
        currentLang === 'fr' ? res.messageFr : res.messageEn,
        !res.success
      );
      if (res.status) renderStatus(res.status);
    });

    document.getElementById('btnRefreshStatus').addEventListener('click', async () => {
      await refreshAll();
      showToast(
        currentLang === 'fr'
          ? 'État du réseau actualisé.'
          : 'Network status refreshed.'
      );
    });

    // Wi-Fi Configuration Controls
    document.getElementById('btnUseCurrentSsid').addEventListener('click', () => {
      const iface = latestStatus && latestStatus.primaryInterface;
      if (iface && iface.connectedSsid) {
        document.getElementById('cfgSsidInput').value = iface.connectedSsid;
        document.getElementById('cfgProfileInput').value =
          iface.connectedProfileName || iface.connectedSsid;
        showToast(
          currentLang === 'fr'
            ? `Réseau actuel "${iface.connectedSsid}" sélectionné.`
            : `Current network "${iface.connectedSsid}" selected.`
        );
      } else {
        showToast(t('msgProfileNotFound'), true);
      }
    });

    document.getElementById('btnImportXml').addEventListener('click', async () => {
      const res = await api.importProfileXml();
      if (res.canceled) return;
      if (res.success) {
        showToast(
          currentLang === 'fr'
            ? 'Profil XML WLAN importé avec succès.'
            : 'WLAN XML profile imported successfully.'
        );
        await refreshNetworksTable();
      } else {
        showToast(
          (currentLang === 'fr' ? res.messageFr : res.messageEn) || res.errorMessage,
          true
        );
      }
    });

    document.getElementById('btnScanNetworks').addEventListener('click', () => {
      refreshNetworksTable();
    });

    // Save Policies Button
    document.getElementById('btnSavePolicies').addEventListener('click', async () => {
      const payload = buildProtectionPayloadFromUi();
      const res = await api.enableProtection(payload);
      showToast(
        currentLang === 'fr' ? res.messageFr : res.messageEn,
        !res.success
      );
      if (res.status) renderStatus(res.status);
    });

    // Backup Tab Buttons
    document.getElementById('btnCreateManualBackup').addEventListener('click', async () => {
      const res = await api.createBackup();
      if (res.success) {
        showToast(
          currentLang === 'fr'
            ? `Sauvegarde créée : ${res.fileName}`
            : `Backup created: ${res.fileName}`
        );
        await refreshBackupsView();
      } else {
        showToast(res.errorMessage || 'Error', true);
      }
    });

    document.getElementById('btnRestoreBaseline').addEventListener('click', async () => {
      const res = await api.restoreBackup(null);
      showToast(
        currentLang === 'fr' ? res.messageFr : res.messageEn,
        !res.success
      );
      if (res.status) renderStatus(res.status);
      await refreshBackupsView();
    });

    // Subscribe to real-time native WLAN events from main process
    api.onWlanEvent(() => {
      refreshAll();
    });

    applyTranslations();
    refreshAll();
  });
})();
