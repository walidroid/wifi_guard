'use strict';

const EventEmitter = require('events');

/**
 * System & WLAN Monitoring Service (src/main/services/monitoring-service.js)
 *
 * Uses event-driven Windows Native Wifi notifications (`WlanRegisterNotification`
 * with `WLAN_NOTIFICATION_SOURCE_ACM | WLAN_NOTIFICATION_SOURCE_MSM`) bridged via
 * `Napi::ThreadSafeFunction`, supplemented by a lightweight, non-aggressive
 * health-check timer (default 15s) to detect Airplane Mode registry changes.
 *
 * Respects administrator intent:
 * NEVER forces reconnection when `config.protectionEnabled` is `false`.
 */
class MonitoringService extends EventEmitter {
  constructor(nativeBridge, wlanService, configManager, logger) {
    super();
    this.nativeBridge = nativeBridge;
    this.addon = nativeBridge.addon;
    this.wlanService = wlanService;
    this.configManager = configManager;
    this.logger = logger;

    this.eventsHistory = [];
    this.maxEvents = 200;
    this.reconnectTimer = null;
    this.fallbackTimer = null;
    this.nativeListening = false;
  }

  start() {
    if (this.nativeBridge.loaded) {
      this.nativeListening = Boolean(
        this.addon.startNotifications((evt) => this._handleNativeEvent(evt))
      );
      if (this.nativeListening) {
        this.logger.info(
          'MONITOR_NATIVE_STARTED',
          'Écoute des notifications natives Windows WLAN (ACM/MSM) activée.',
          'Native Windows WLAN notification listener (ACM/MSM) started.'
        );
      }
    }

    const cfg = this.configManager.getConfig();
    const intervalMs = Math.max(
      10000,
      Number(cfg.monitoring && cfg.monitoring.fallbackCheckIntervalMs) || 15000
    );

    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = setInterval(() => this._checkHealth(), intervalMs);
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.nativeListening && this.nativeBridge.loaded) {
      this.addon.stopNotifications();
      this.nativeListening = false;
    }
  }

  _recordEvent(eventObj) {
    const stamped = {
      timestamp: new Date().toISOString(),
      ...eventObj
    };
    this.eventsHistory.unshift(stamped);
    if (this.eventsHistory.length > this.maxEvents) {
      this.eventsHistory.length = this.maxEvents;
    }
    this.emit('wlan-event', stamped);
  }

  _handleNativeEvent(evt) {
    const cfg = this.configManager.getConfig();
    let descriptionFr = `Événement ${evt.source} : ${evt.codeName}`;
    let descriptionEn = `${evt.source} event: ${evt.codeName}`;

    if (evt.codeName === 'disconnected' || evt.codeName === 'msm_disconnected') {
      descriptionFr = `Déconnexion détectée du réseau "${evt.ssid || evt.profileName || 'Wi-Fi'}"${evt.reasonMessage ? ' (' + evt.reasonMessage + ')' : ''}.`;
      descriptionEn = `Disconnection detected from network "${evt.ssid || evt.profileName || 'Wi-Fi'}"${evt.reasonMessage ? ' (' + evt.reasonMessage + ')' : ''}.`;

      this.wlanService.setLastDisconnectReason({
        code: `WLAN_REASON_${evt.reasonCode || 0}`,
        fr: descriptionFr,
        en: descriptionEn
      });

      this.logger.warn('WLAN_DISCONNECTED', descriptionFr, descriptionEn, evt);
      this._scheduleAutoReconnectIfProtected('disconnect_event', evt.interfaceGuid);
    } else if (evt.codeName === 'connection_complete') {
      descriptionFr = `Connexion établie au SSID "${evt.ssid || evt.profileName}".`;
      descriptionEn = `Connection established to SSID "${evt.ssid || evt.profileName}".`;
      this.wlanService.setLastDisconnectReason(null);
      this.logger.info('WLAN_CONNECTED', descriptionFr, descriptionEn, evt);

      // Verify connected SSID matches allowed laboratory SSID when protection is active
      if (
        cfg.protectionEnabled &&
        cfg.labNetwork.ssid &&
        evt.ssid &&
        evt.ssid !== cfg.labNetwork.ssid
      ) {
        this.logger.warn(
          'UNAUTHORIZED_SSID_DETECTED',
          `Connexion non autorisée détectée sur "${evt.ssid}". Rétablissement du réseau du laboratoire "${cfg.labNetwork.ssid}".`,
          `Unauthorized connection detected on "${evt.ssid}". Re-applying laboratory network "${cfg.labNetwork.ssid}".`
        );
        this._scheduleAutoReconnectIfProtected('unauthorized_ssid', evt.interfaceGuid);
      }
    } else if (evt.codeName === 'radio_state_change') {
      descriptionFr = `Changement d’état radio Wi-Fi (Logiciel: ${evt.softwareRadioState}, Matériel: ${evt.hardwareRadioState}).`;
      descriptionEn = `Wi-Fi radio state changed (Software: ${evt.softwareRadioState}, Hardware: ${evt.hardwareRadioState}).`;
      this.logger.warn('RADIO_STATE_CHANGE', descriptionFr, descriptionEn, evt);

      if (
        cfg.protectionEnabled &&
        cfg.restrictions.autoReEnableSoftwareRadio &&
        evt.softwareRadioState === 'off' &&
        evt.hardwareRadioState !== 'off' &&
        this.addon.isProcessElevated()
      ) {
        this.logger.info(
          'RADIO_AUTO_RESTORE',
          'Réactivation automatique de la radio logicielle Wi-Fi.',
          'Automatically re-enabling software Wi-Fi radio.'
        );
        this.addon.setSoftwareRadioState(evt.interfaceGuid, true);
        this._scheduleAutoReconnectIfProtected('radio_restored', evt.interfaceGuid);
      }
    } else if (evt.codeName === 'profile_change' || evt.codeName === 'filter_list_change') {
      descriptionFr = `Modification de profil ou de filtre WLAN détectée (${evt.codeName}).`;
      descriptionEn = `WLAN profile or filter modification detected (${evt.codeName}).`;
      this.logger.info('WLAN_CONFIG_EVENT', descriptionFr, descriptionEn, evt);
    }

    this._recordEvent({
      ...evt,
      descriptionFr,
      descriptionEn
    });
  }

  _scheduleAutoReconnectIfProtected(triggerReason, interfaceGuid) {
    const cfg = this.configManager.getConfig();
    // Crucial requirement: Do NOT continuously force reconnection when administrator disables protection
    if (!cfg.protectionEnabled || !cfg.labNetwork.reconnectOnDisconnect) {
      return;
    }
    if (!cfg.labNetwork.ssid && !cfg.labNetwork.profileName) {
      return;
    }

    if (this.reconnectTimer) {
      return; // Debounce pending reconnection timer
    }

    const delayMs = Math.max(2000, Number(cfg.labNetwork.reconnectDelayMs) || 4000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const latestCfg = this.configManager.getConfig();
      if (!latestCfg.protectionEnabled || !latestCfg.labNetwork.reconnectOnDisconnect) {
        return;
      }

      const status = this.addon.getWlanStatus();
      const iface =
        (status.interfaces || []).find(
          (i) => i.guid === (interfaceGuid || latestCfg.labNetwork.interfaceGuid)
        ) || (status.interfaces || [])[0];

      if (!iface) return;
      if (iface.connected && iface.connectedSsid === latestCfg.labNetwork.ssid) {
        return; // Already reconnected
      }

      if (
        iface.softwareRadioState === 'off' &&
        iface.hardwareRadioState !== 'off' &&
        latestCfg.restrictions.autoReEnableSoftwareRadio &&
        this.addon.isProcessElevated()
      ) {
        this.addon.setSoftwareRadioState(iface.guid, true);
      }

      const profName = latestCfg.labNetwork.profileName || latestCfg.labNetwork.ssid;
      const connRes = this.addon.connectToProfile(
        iface.guid,
        profName,
        latestCfg.labNetwork.ssid
      );

      this.logger.info(
        'AUTO_RECONNECT_ATTEMPT',
        `Tentative de reconnexion automatique au réseau "${latestCfg.labNetwork.ssid}" (motif: ${triggerReason}).`,
        `Automatic reconnection attempt to "${latestCfg.labNetwork.ssid}" (trigger: ${triggerReason}).`,
        connRes
      );
    }, delayMs);
  }

  _checkHealth() {
    const cfg = this.configManager.getConfig();
    if (!cfg.protectionEnabled) {
      return;
    }
    const status = this.addon.getWlanStatus();
    if (!status.wlanServiceRunning) return;

    const iface =
      (status.interfaces || []).find((i) => i.guid === cfg.labNetwork.interfaceGuid) ||
      (status.interfaces || [])[0];

    if (iface && (!iface.connected || iface.connectedSsid !== cfg.labNetwork.ssid)) {
      this._scheduleAutoReconnectIfProtected('periodic_health_check', iface.guid);
    }
  }

  getEventsHistory() {
    return this.eventsHistory;
  }
}

module.exports = { MonitoringService };
