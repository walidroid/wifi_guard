'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Native Windows Addon Loader (src/main/services/native-bridge.js)
 * Loads the compiled C++ N-API addon `wlan_native.node` from:
 *   1. Packed portable app resources (`process.resourcesPath/native/wlan_native.node`)
 *   2. Standard node-gyp build output (`build/Release/wlan_native.node`)
 * Zero PowerShell, CMD, or hidden shell fallback is ever used.
 */
function loadNativeAddon(logger) {
  const candidatePaths = [
    path.resolve(process.cwd(), 'native', 'wlan_native.node'),
    path.resolve(process.cwd(), 'build', 'Release', 'wlan_native.node'),
    path.resolve(process.cwd(), 'wlan_native.node'),
    path.resolve(__dirname, '../../../build/Release/wlan_native.node'),
    path.resolve(__dirname, '../../../build/Debug/wlan_native.node'),
    path.resolve(__dirname, '../../native/wlan_native.node'),
    path.resolve(__dirname, '../native/wlan_native.node'),
    path.resolve(__dirname, 'wlan_native.node'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'native', 'wlan_native.node')
      : null,
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'wlan_native.node')
      : null
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const addon = require(candidate);
        if (logger) {
          logger.info(
            'NATIVE_ADDON_LOADED',
            'Module natif C++ Windows WLAN chargé avec succès.',
            'Native Windows C++ WLAN addon loaded successfully.',
            { path: candidate }
          );
        }
        return { loaded: true, addon, binaryPath: candidate, loadError: null };
      }
    } catch (err) {
      lastError = err;
    }
  }

  const errMsg = lastError
    ? lastError.message
    : 'wlan_native.node binary not found in build/Release or resourcesPath';

  if (logger) {
    logger.error(
      'NATIVE_ADDON_MISSING',
      'Le module natif C++ (wlan_native.node) est introuvable ou incompatible avec cette plateforme.',
      'The native C++ addon (wlan_native.node) is missing or incompatible with this platform.',
      { error: errMsg, platform: process.platform, arch: process.arch }
    );
  }

  // Return an explicit unavailable bridge that reports real errors rather than simulating success
  return {
    loaded: false,
    binaryPath: null,
    loadError: errMsg,
    addon: {
      isProcessElevated: () => false,
      requestUacElevation: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé / Native C++ module not loaded'
      }),
      getWlanStatus: () => ({
        wlanServiceRunning: false,
        airplaneModeKnown: false,
        airplaneModeEnabled: false,
        showDeniedNetworks: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé (' + errMsg + ')',
        interfaces: []
      }),
      getAvailableNetworks: () => [],
      getProfiles: () => [],
      setProfileXml: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      setPreferredProfilePosition: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      getFilterLists: () => ({
        allowList: [],
        denyList: [],
        gpAllowList: [],
        gpDenyList: [],
        showDeniedNetworks: false
      }),
      setFilterLists: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      connectToProfile: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      setSoftwareRadioState: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      getPolicyState: () => ({
        hasSettingsPageVisibility: false,
        settingsPageVisibility: '',
        hasNoNetSetup: false,
        noNetSetup: 0,
        userProfileSddl: ''
      }),
      applyPolicyState: () => ({
        success: false,
        errorCode: 126,
        errorMessage: 'Module natif C++ wlan_native.node non chargé'
      }),
      startNotifications: () => false,
      stopNotifications: () => true
    }
  };
}

module.exports = { loadNativeAddon };
