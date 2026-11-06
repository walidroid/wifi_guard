'use strict';

/**
 * WLAN Management Service (src/main/services/wlan-service.js)
 * Orchestrates Windows Native Wifi API calls through the C++ N-API addon.
 * Zero shell, PowerShell, or CMD execution.
 */
class WlanService {
  constructor(nativeBridge, configManager, logger) {
    this.nativeBridge = nativeBridge;
    this.addon = nativeBridge.addon;
    this.configManager = configManager;
    this.logger = logger;
    this.lastDisconnectReason = null;
  }

  setLastDisconnectReason(reason) {
    this.lastDisconnectReason = reason;
  }

  /**
   * Builds a compliant Windows WLAN Profile XML with <connectionMode>auto</connectionMode>
   * or updates an existing exported XML profile to enable/disable automatic connection.
   */
  buildOrUpdateAutoConnectXml(existingXml, ssid, autoConnect = true) {
    const mode = autoConnect ? 'auto' : 'manual';
    if (existingXml && existingXml.includes('<WLANProfile')) {
      if (existingXml.includes('<connectionMode>')) {
        return existingXml.replace(
          /<connectionMode>(auto|manual)<\/connectionMode>/i,
          `<connectionMode>${mode}</connectionMode>`
        );
      }
      return existingXml.replace(
        /<\/connectionType>/i,
        `</connectionType>\n\t<connectionMode>${mode}</connectionMode>`
      );
    }

    // Escape XML entities in SSID
    const escapedSsid = String(ssid)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const hexSsid = Buffer.from(String(ssid), 'utf8').toString('hex').toUpperCase();

    return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
\t<name>${escapedSsid}</name>
\t<SSIDConfig>
\t\t<SSID>
\t\t\t<hex>${hexSsid}</hex>
\t\t\t<name>${escapedSsid}</name>
\t\t</SSID>
\t\t<nonBroadcast>false</nonBroadcast>
\t</SSIDConfig>
\t<connectionType>ESS</connectionType>
\t<connectionMode>${mode}</connectionMode>
\t<MSM>
\t\t<security>
\t\t\t<authEncryption>
\t\t\t\t<authentication>open</authentication>
\t\t\t\t<encryption>none</encryption>
\t\t\t\t<useOneX>false</useOneX>
\t\t\t</authEncryption>
\t\t</security>
\t</MSM>
</WLANProfile>`;
  }

  /**
   * Queries current network status, adapter state, radio state, filter state,
   * and computes overall protection status (protected / partial / unprotected / unknown).
   */
  getComprehensiveStatus() {
    const isElevated = Boolean(this.addon.isProcessElevated());
    const rawWlan = this.addon.getWlanStatus();
    const filters = this.addon.getFilterLists();
    const policy = this.addon.getPolicyState();
    const config = this.configManager.getConfig();

    const interfaces = Array.isArray(rawWlan.interfaces) ? rawWlan.interfaces : [];
    const primaryInterface =
      interfaces.find((i) => i.guid === config.labNetwork.interfaceGuid) ||
      interfaces[0] ||
      null;

    let disconnectDiagnosis = null;
    if (!rawWlan.wlanServiceRunning) {
      disconnectDiagnosis = {
        code: 'WLAN_SVC_DOWN',
        fr: 'Service WLAN AutoConfig indisponible ou arrêté.',
        en: 'WLAN AutoConfig service is unavailable or stopped.'
      };
    } else if (rawWlan.airplaneModeEnabled) {
      disconnectDiagnosis = {
        code: 'AIRPLANE_MODE_ON',
        fr: 'Mode avion détecté actif sur le système.',
        en: 'System Airplane mode detected as active.'
      };
    } else if (!primaryInterface) {
      disconnectDiagnosis = {
        code: 'NO_ADAPTER',
        fr: 'Aucune carte réseau Wi-Fi détectée (ou adaptateur désactivé dans le Gestionnaire de périphériques).',
        en: 'No Wi-Fi network adapter detected (or adapter disabled in Device Manager).'
      };
    } else if (primaryInterface.hardwareRadioState === 'off') {
      disconnectDiagnosis = {
        code: 'HW_RADIO_OFF',
        fr: 'Radio Wi-Fi matérielle désactivée (interrupteur physique ou mode avion matériel).',
        en: 'Hardware Wi-Fi radio is disabled (physical switch or hardware airplane mode).'
      };
    } else if (primaryInterface.softwareRadioState === 'off') {
      disconnectDiagnosis = {
        code: 'SW_RADIO_OFF',
        fr: 'Radio Wi-Fi logicielle désactivée.',
        en: 'Software Wi-Fi radio is turned off.'
      };
    } else if (!primaryInterface.connected && this.lastDisconnectReason) {
      disconnectDiagnosis = this.lastDisconnectReason;
    } else if (!primaryInterface.connected) {
      disconnectDiagnosis = {
        code: 'DISCONNECTED',
        fr: 'Adaptateur Wi-Fi actif mais non connecté à un point d’accès.',
        en: 'Wi-Fi adapter is active but not connected to an access point.'
      };
    }

    const targetSsid = config.labNetwork.ssid || '';
    const allowList = Array.isArray(filters.allowList) ? filters.allowList : [];
    const denyList = Array.isArray(filters.denyList) ? filters.denyList : [];

    const isTargetPermitted =
      Boolean(targetSsid) && allowList.some((item) => item.ssid === targetSsid);
    const isDenyAllInfraActive = denyList.some(
      (item) => item.ssid === '' && item.bssType === 'infrastructure'
    );
    const isConnectedToLab =
      Boolean(primaryInterface) &&
      primaryInterface.connected &&
      (!targetSsid || primaryInterface.connectedSsid === targetSsid);

    let protectionStatus = 'unknown'; // green='protected', orange='partial', red='unprotected', gray='unknown'
    if (!this.nativeBridge.loaded || !rawWlan.wlanServiceRunning) {
      protectionStatus = 'unknown';
    } else if (isTargetPermitted && isDenyAllInfraActive) {
      if (isConnectedToLab && !filters.showDeniedNetworks) {
        protectionStatus = 'protected';
      } else {
        protectionStatus = 'partial';
      }
    } else if (isTargetPermitted || isDenyAllInfraActive || policy.hasSettingsPageVisibility) {
      protectionStatus = 'partial';
    } else {
      protectionStatus = 'unprotected';
    }

    return {
      nativeAddonLoaded: this.nativeBridge.loaded,
      nativeLoadError: this.nativeBridge.loadError,
      isAdmin: isElevated,
      wlanServiceRunning: Boolean(rawWlan.wlanServiceRunning),
      airplaneModeKnown: Boolean(rawWlan.airplaneModeKnown),
      airplaneModeEnabled: Boolean(rawWlan.airplaneModeEnabled),
      showDeniedNetworks: Boolean(filters.showDeniedNetworks),
      protectionStatus,
      lastUpdated: config.lastUpdated,
      disconnectDiagnosis,
      primaryInterface,
      interfaces,
      filters,
      policy,
      config
    };
  }

  /**
   * Lists visible networks and saved profiles on the selected adapter.
   */
  getNetworksAndProfiles(interfaceGuid) {
    const status = this.addon.getWlanStatus();
    const guid =
      interfaceGuid ||
      (status.interfaces && status.interfaces[0] ? status.interfaces[0].guid : '');
    if (!guid) {
      return { interfaceGuid: '', availableNetworks: [], savedProfiles: [] };
    }

    const availableNetworks = this.addon.getAvailableNetworks(guid);
    const savedProfiles = this.addon.getProfiles(guid).map((p) => ({
      name: p.name,
      flags: p.flags,
      autoConnect: p.autoConnect
      // Never expose raw XML with keyMaterial to the renderer
    }));

    return {
      interfaceGuid: guid,
      availableNetworks,
      savedProfiles
    };
  }

  /**
   * Applies Feature A & Feature B:
   * - Configures the laboratory Wi-Fi profile for automatic connection (<connectionMode>auto</connectionMode>)
   * - Places the laboratory Wi-Fi profile at position 0 in the preferred list (WlanSetProfilePosition)
   * - Sets the user permit filter list to allow ONLY the laboratory SSID (WlanSetFilterList)
   * - Sets the user deny filter list to block all other infrastructure (and optionally ad-hoc) networks
   * - Hides denied networks from the Windows available networks list (WlanSetAutoConfigParameter)
   * - Initiates connection to the laboratory SSID if not already connected (WlanConnect)
   */
  applyLabWifiProtection(options) {
    if (!this.addon.isProcessElevated()) {
      this.logger.warn(
        'ADMIN_REQUIRED',
        'Privilèges administrateur requis pour activer la protection Wi-Fi.',
        'Administrator privileges required to enable Wi-Fi protection.'
      );
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      };
    }

    const status = this.addon.getWlanStatus();
    if (!status.wlanServiceRunning) {
      this.logger.error(
        'WLAN_SERVICE_UNAVAILABLE',
        'Service WLAN indisponible.',
        'WLAN service unavailable.'
      );
      return {
        success: false,
        code: 'WLAN_SERVICE_UNAVAILABLE',
        messageFr: 'Service WLAN indisponible.',
        messageEn: 'WLAN service unavailable.'
      };
    }

    const interfaces = status.interfaces || [];
    if (interfaces.length === 0) {
      this.logger.error(
        'ADAPTER_NOT_FOUND',
        'Carte Wi-Fi introuvable.',
        'Wi-Fi adapter not found.'
      );
      return {
        success: false,
        code: 'ADAPTER_NOT_FOUND',
        messageFr: 'Carte Wi-Fi introuvable.',
        messageEn: 'Wi-Fi adapter not found.'
      };
    }

    const iface =
      interfaces.find((i) => i.guid === options.interfaceGuid) || interfaces[0];
    const targetSsid = (options.ssid || iface.connectedSsid || '').trim();
    const targetProfileName = (options.profileName || iface.connectedProfileName || targetSsid).trim();

    if (!targetSsid) {
      return {
        success: false,
        code: 'SSID_REQUIRED',
        messageFr: 'Profil Wi-Fi du laboratoire introuvable ou SSID non sélectionné.',
        messageEn: 'Laboratory Wi-Fi profile not found or SSID not selected.'
      };
    }

    // 1. Ensure software radio is ON if requested
    if (iface.softwareRadioState === 'off') {
      this.addon.setSoftwareRadioState(iface.guid, true);
    }

    // 2. Verify or import/update profile XML for automatic connection
    const profiles = this.addon.getProfiles(iface.guid);
    const existingProfile = profiles.find(
      (p) => p.name === targetProfileName || p.name === targetSsid
    );

    if (!existingProfile && !options.customProfileXml) {
      this.logger.error(
        'PROFILE_NOT_FOUND',
        `Profil Wi-Fi du laboratoire introuvable pour le SSID "${targetSsid}". Connectez-vous d'abord au réseau ou importez son profil XML.`,
        `Laboratory Wi-Fi profile not found for SSID "${targetSsid}". Connect to the network first or import its XML profile.`
      );
      return {
        success: false,
        code: 'PROFILE_NOT_FOUND',
        messageFr: 'Profil Wi-Fi du laboratoire introuvable.',
        messageEn: 'Laboratory Wi-Fi profile not found.'
      };
    }

    const baseXml = options.customProfileXml || (existingProfile ? existingProfile.xml : '');
    const updatedXml = this.buildOrUpdateAutoConnectXml(
      baseXml,
      targetSsid,
      options.autoConnect !== false
    );

    const setProfRes = this.addon.setProfileXml(iface.guid, updatedXml);
    if (!setProfRes.success) {
      this.logger.error(
        'PROFILE_SET_FAILED',
        'Impossible de configurer le profil Wi-Fi du laboratoire.',
        'Unable to configure the laboratory Wi-Fi profile.',
        setProfRes
      );
      return {
        success: false,
        code: 'PROFILE_SET_FAILED',
        messageFr: `Impossible de configurer le profil Wi-Fi : ${setProfRes.errorMessage}`,
        messageEn: `Unable to configure Wi-Fi profile: ${setProfRes.errorMessage}`
      };
    }

    // 3. Place profile at position 0 (highest priority)
    this.addon.setPreferredProfilePosition(iface.guid, targetProfileName, 0);

    // 4. Apply Native WLAN Allow & Deny Filters + Hide Denied Networks
    const hideBlocked = options.hideBlockedNetworks !== false;
    const blockAdhoc = options.blockAdhocNetworks !== false;
    const filterRes = this.addon.setFilterLists(
      [targetSsid],
      [],
      true,        // denyAllInfrastructure (wildcard block on all non-permitted SSIDs)
      blockAdhoc,  // denyAllAdhoc
      hideBlocked  // hideDeniedNetworks via WlanSetAutoConfigParameter
    );

    if (!filterRes.success) {
      this.logger.error(
        'FILTER_APPLY_FAILED',
        'Impossible d’appliquer les filtres réseau.',
        'Unable to apply network filters.',
        filterRes
      );
      return {
        success: false,
        code: 'FILTER_APPLY_FAILED',
        messageFr: 'Impossible d’appliquer les filtres réseau.',
        messageEn: 'Unable to apply network filters.',
        details: filterRes
      };
    }

    // 5. Connect to the laboratory profile if not already connected to it
    if (!iface.connected || iface.connectedSsid !== targetSsid) {
      this.addon.connectToProfile(iface.guid, targetProfileName, targetSsid);
    }

    this.logger.info(
      'WLAN_PROTECTION_APPLIED',
      `Protection Wi-Fi activée pour le SSID "${targetSsid}" (autres réseaux bloqués et masqués).`,
      `Wi-Fi protection enabled for SSID "${targetSsid}" (other networks blocked and hidden).`
    );

    return {
      success: true,
      interfaceGuid: iface.guid,
      adapterName: iface.description,
      ssid: targetSsid,
      profileName: targetProfileName
    };
  }

  /**
   * Clears the user permit/deny filter lists and restores visibility of networks
   * when the administrator disables Wi-Fi protection.
   */
  disableLabWifiFilters() {
    if (!this.addon.isProcessElevated()) {
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis.',
        messageEn: 'Administrator privileges required.'
      };
    }

    const filterRes = this.addon.setFilterLists([], [], false, false, false);
    if (!filterRes.success) {
      return {
        success: false,
        code: 'FILTER_CLEAR_FAILED',
        messageFr: 'Impossible de retirer les filtres réseau.',
        messageEn: 'Unable to remove network filters.',
        details: filterRes
      };
    }

    this.logger.info(
      'WLAN_PROTECTION_DISABLED',
      'Filtres de restriction Wi-Fi désactivés par l’administrateur.',
      'Wi-Fi restriction filters disabled by administrator.'
    );
    return { success: true };
  }
}

module.exports = { WlanService };
