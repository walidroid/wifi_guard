'use strict';

/**
 * Policy & System Restriction Service (src/main/services/policy-service.js)
 * Manages Windows 10 Pro Local Group Policy / Registry settings and WLAN object ACLs.
 *
 * Architectural Transparency:
 * Explicitly distinguishes between:
 *  1. Kernel/Service Enforcement (Enforced by WlanSvc regardless of UI):
 *     - Native WLAN Permit/Deny Filters (`WlanSetFilterList`)
 *     - Hidden Denied Networks (`WlanSetAutoConfigParameter` with `wlan_autoconf_opcode_show_denied_networks`)
 *     - Per-User WLAN Profile Creation Lock (`WlanSetSecuritySettings` on `wlan_secure_add_new_per_user_profiles`)
 *       restricting `WLAN_WRITE_ACCESS` to Administrators `BA` and System `SY`)
 *  2. Interface Visibility Restrictions (UI Hiding in Windows 10 Settings / Control Panel):
 *     - `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\SettingsPageVisibility`
 *       (`hide:network-wifi;network-airplanemode;network-proxy;network-vpn;network-mobilehotspot`)
 *     - `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Network\NoNetSetup`
 *  3. Documented Windows 10 Pro Limitations:
 *     - Windows 10 Pro does NOT provide a supported public Win32/Group Policy API that permanently
 *       disables hardware/OS Airplane Mode for all users while keeping Wi-Fi operational.
 *     - Hiding `ms-settings:network-airplanemode` only hides the Settings page; hardware Fn keys
 *       or the Action Center quick-action tile can still toggle Airplane Mode, which is why the
 *       Monitoring Service detects `SystemRadioState` and `WLAN_PHY_RADIO_STATE` in real time.
 */
class PolicyService {
  constructor(nativeBridge, logger) {
    this.nativeBridge = nativeBridge;
    this.addon = nativeBridge.addon;
    this.logger = logger;

    // Standard SDDL that grants Read/Execute/Write to Built-in Admins (BA), System (SY),
    // and Network Config Operators (NO), while granting only Read/Execute (no Write) to Interactive Users (IU)
    this.LOCKED_USER_PROFILE_SDDL =
      'D:(A;;0x7;;;BA)(A;;0x7;;;SY)(A;;0x7;;;NO)(A;;0x3;;;IU)';
  }

  getCurrentPolicyState() {
    return this.addon.getPolicyState();
  }

  /**
   * Merges our requested hidden Settings pages into any pre-existing SettingsPageVisibility
   * rule so we don't clobber unrelated pages hidden by the school IT administrator.
   */
  _buildSettingsPageVisibilityString(existingValue, hideWifi, hideAirplane) {
    const pagesToManage = [
      'network-wifi',
      'network-proxy',
      'network-vpn',
      'network-mobilehotspot',
      'network-airplanemode'
    ];

    let existingPages = [];
    if (existingValue && existingValue.toLowerCase().startsWith('hide:')) {
      existingPages = existingValue
        .slice(5)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const preserved = existingPages.filter((p) => !pagesToManage.includes(p));
    const active = [...preserved];

    if (hideWifi) {
      active.push('network-wifi', 'network-proxy', 'network-vpn', 'network-mobilehotspot');
    }
    if (hideAirplane) {
      active.push('network-airplanemode');
    }

    if (active.length === 0) {
      return null;
    }
    return `hide:${Array.from(new Set(active)).join(';')}`;
  }

  applyRestrictions(restrictionConfig) {
    if (!this.addon.isProcessElevated()) {
      return {
        success: false,
        code: 'ADMIN_REQUIRED',
        messageFr: 'Privilèges administrateur requis pour modifier les stratégies Windows.',
        messageEn: 'Administrator privileges required to modify Windows policies.'
      };
    }

    const current = this.addon.getPolicyState();
    const visibilityStr = this._buildSettingsPageVisibilityString(
      current.settingsPageVisibility,
      Boolean(restrictionConfig.hideWindowsWifiSettingsPage),
      Boolean(restrictionConfig.hideWindowsAirplaneSettingsPage)
    );

    const payload = {
      settingsPageVisibility: visibilityStr,
      noNetSetup: restrictionConfig.restrictNoNetSetupFlag ? 1 : null
    };

    if (restrictionConfig.lockPerUserProfileCreation) {
      payload.userProfileSddl = this.LOCKED_USER_PROFILE_SDDL;
    }

    const res = this.addon.applyPolicyState(payload);
    if (!res.success) {
      this.logger.error(
        'POLICY_APPLY_FAILED',
        'Échec de l’application des stratégies de restriction Windows.',
        'Failed to apply Windows restriction policies.',
        res
      );
      return {
        success: false,
        code: 'POLICY_APPLY_FAILED',
        messageFr: `Erreur lors de l’application des stratégies : ${res.errorMessage}`,
        messageEn: `Error applying policies: ${res.errorMessage}`
      };
    }

    this.logger.info(
      'POLICY_APPLIED',
      'Stratégies Windows et visibilité des pages Paramètres mises à jour.',
      'Windows policies and Settings page visibility updated.',
      payload
    );

    return {
      success: true,
      applied: payload
    };
  }
}

module.exports = { PolicyService };
