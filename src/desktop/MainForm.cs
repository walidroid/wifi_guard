using System;
using System.Drawing;
using System.Security.Principal;
using System.Windows.Forms;

namespace WiFiLabGuardian
{
    public class MainForm : Form
    {
        private ProtectionController _controller;
        private Timer _refreshTimer;

        // Header
        private Panel pnlHeader;
        private Label lblHeaderTitle;
        private Label lblHeaderSubtitle;
        private Label lblAdminBadge;

        // Card 1 : Protection Wi-Fi
        private GroupBox grpWifi;
        private Label lblWifiStatus;
        private Label lblWifiDetails;
        private Button btnToggleWifiProtection;

        // Card 2 : Mode Avion
        private GroupBox grpAirplane;
        private Label lblAirplaneStatus;
        private Label lblAirplaneDesc;
        private Button btnToggleAirplaneMode;

        // Footer / Status
        private StatusStrip statusStrip;
        private ToolStripStatusLabel statusLabel;

        private bool _isWifiProtected = false;
        private bool _isAirplaneHidden = false;
        private string _activeSsid = string.Empty;

        public MainForm()
        {
            _controller = new ProtectionController();

            InitializeComponent();

            _refreshTimer = new Timer();
            _refreshTimer.Interval = 3000;
            _refreshTimer.Tick += (s, e) => RefreshStatus();
            _refreshTimer.Start();

            RefreshStatus();
        }

        private void InitializeComponent()
        {
            this.Text = "WiFi Lab Guardian — Outil Portable";
            this.Size = new Size(540, 480);
            this.MinimumSize = new Size(500, 460);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular);

            try
            {
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            // 1. Header Panel
            pnlHeader = new Panel
            {
                Dock = DockStyle.Top,
                Height = 72,
                BackColor = Color.FromArgb(15, 23, 42),
                Padding = new Padding(16, 12, 16, 12)
            };

            lblHeaderTitle = new Label
            {
                Text = "🛡️ WiFi Lab Guardian",
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(16, 12)
            };

            lblHeaderSubtitle = new Label
            {
                Text = "Application Portable • Administration Wi-Fi Salle Informatique",
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 8.5F),
                AutoSize = true,
                Location = new Point(18, 38)
            };

            bool isAdmin = IsRunningAsAdmin();
            lblAdminBadge = new Label
            {
                Text = isAdmin ? "🛡️ Administrateur" : "⚠️ Standard",
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                ForeColor = isAdmin ? Color.FromArgb(34, 197, 94) : Color.FromArgb(239, 68, 68),
                BackColor = Color.FromArgb(30, 41, 59),
                TextAlign = ContentAlignment.MiddleCenter,
                Size = new Size(130, 28),
                Location = new Point(376, 20),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };

            pnlHeader.Controls.Add(lblHeaderTitle);
            pnlHeader.Controls.Add(lblHeaderSubtitle);
            pnlHeader.Controls.Add(lblAdminBadge);

            // 2. Card 1 : Protection Wi-Fi
            grpWifi = new GroupBox
            {
                Text = " 1. Protection Wi-Fi du Laboratoire ",
                Location = new Point(16, 88),
                Size = new Size(492, 148),
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                BackColor = Color.White
            };

            lblWifiStatus = new Label
            {
                Text = "⚪ ÉTAT : DÉSACTIVÉE (Tous les réseaux sont autorisés)",
                Location = new Point(16, 26),
                AutoSize = true,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(100, 116, 139)
            };

            lblWifiDetails = new Label
            {
                Text = "Carte Wi-Fi : Détection en cours...",
                Location = new Point(16, 52),
                Size = new Size(460, 36),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
                ForeColor = Color.FromArgb(71, 85, 105)
            };

            btnToggleWifiProtection = new Button
            {
                Text = "🔒 ACTIVER LA PROTECTION WI-FI",
                Location = new Point(16, 94),
                Size = new Size(460, 40),
                BackColor = Color.FromArgb(22, 163, 74),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnToggleWifiProtection.FlatAppearance.BorderSize = 0;
            btnToggleWifiProtection.Click += (s, e) => ToggleWifiProtection();

            grpWifi.Controls.Add(lblWifiStatus);
            grpWifi.Controls.Add(lblWifiDetails);
            grpWifi.Controls.Add(btnToggleWifiProtection);

            // 3. Card 2 : Mode Avion
            grpAirplane = new GroupBox
            {
                Text = " 2. Mode Avion (Barre des tâches, Clavier & Paramètres) ",
                Location = new Point(16, 250),
                Size = new Size(492, 136),
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                BackColor = Color.White
            };

            lblAirplaneStatus = new Label
            {
                Text = "👁️ ÉTAT : VISIBLE & ACTIF (Les élèves peuvent couper le Wi-Fi)",
                Location = new Point(16, 26),
                AutoSize = true,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(71, 85, 105)
            };

            lblAirplaneDesc = new Label
            {
                Text = "Neutralise le service radio (RmSvc), retire le bouton du menu réseau de la barre des tâches et verrouille la coupure radio.",
                Location = new Point(16, 52),
                Size = new Size(460, 32),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
                ForeColor = Color.FromArgb(100, 116, 139)
            };

            btnToggleAirplaneMode = new Button
            {
                Text = "🚫 MASQUER & DÉSACTIVER LE MODE AVION",
                Location = new Point(16, 88),
                Size = new Size(460, 36),
                BackColor = Color.FromArgb(220, 38, 38),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnToggleAirplaneMode.FlatAppearance.BorderSize = 0;
            btnToggleAirplaneMode.Click += (s, e) => ToggleAirplaneMode();

            grpAirplane.Controls.Add(lblAirplaneStatus);
            grpAirplane.Controls.Add(lblAirplaneDesc);
            grpAirplane.Controls.Add(btnToggleAirplaneMode);

            // 4. Status Strip
            statusStrip = new StatusStrip { BackColor = Color.FromArgb(241, 245, 249) };
            statusLabel = new ToolStripStatusLabel { Text = "Prêt. Application 100% autonome et portable." };
            statusStrip.Items.Add(statusLabel);

            this.Controls.Add(statusStrip);
            this.Controls.Add(grpAirplane);
            this.Controls.Add(grpWifi);
            this.Controls.Add(pnlHeader);
        }

        private bool IsRunningAsAdmin()
        {
            try
            {
                WindowsIdentity id = WindowsIdentity.GetCurrent();
                WindowsPrincipal principal = new WindowsPrincipal(id);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        private void RefreshStatus()
        {
            try
            {
                // État Wi-Fi
                var info = _controller.GetCurrentWifiInfo();
                string permittedSsid;
                _isWifiProtected = _controller.IsWifiProtectionActive(out permittedSsid);

                if (!string.IsNullOrEmpty(info.ConnectedSsid))
                {
                    _activeSsid = info.ConnectedSsid;
                }

                if (_isWifiProtected)
                {
                    string protectedOn = !string.IsNullOrEmpty(permittedSsid) ? permittedSsid : _activeSsid;
                    lblWifiStatus.Text = string.Format("🔒 ÉTAT : ACTIVÉE (Réseau autorisé : \"{0}\")", protectedOn);
                    lblWifiStatus.ForeColor = Color.FromArgb(22, 163, 74);

                    btnToggleWifiProtection.Text = "🔓 DÉSACTIVER LA PROTECTION";
                    btnToggleWifiProtection.BackColor = Color.FromArgb(220, 38, 38);
                }
                else
                {
                    lblWifiStatus.Text = "⚪ ÉTAT : DÉSACTIVÉE (Tous les réseaux sont autorisés)";
                    lblWifiStatus.ForeColor = Color.FromArgb(100, 116, 139);

                    btnToggleWifiProtection.Text = "🔒 ACTIVER LA PROTECTION WI-FI";
                    btnToggleWifiProtection.BackColor = Color.FromArgb(22, 163, 74);
                }

                if (info.HasAdapter)
                {
                    string connText = info.IsConnected
                        ? string.Format("Connecté à \"{0}\" (Signal : {1}%)", info.ConnectedSsid, info.SignalQuality)
                        : "Non connecté";
                    lblWifiDetails.Text = string.Format("Carte : {0}\nStatut : {1}", info.AdapterDescription, connText);
                }
                else
                {
                    lblWifiDetails.Text = "Aucune carte réseau Wi-Fi active détectée sur cette machine.";
                }

                // État Mode Avion
                _isAirplaneHidden = _controller.IsAirplaneModeHidden();
                if (_isAirplaneHidden)
                {
                    lblAirplaneStatus.Text = "🚫 ÉTAT : TOTALEMENT MASQUÉ & DÉSACTIVÉ";
                    lblAirplaneStatus.ForeColor = Color.FromArgb(220, 38, 38);

                    btnToggleAirplaneMode.Text = "👁️ RÉTABLIR LE BOUTON MODE AVION";
                    btnToggleAirplaneMode.BackColor = Color.FromArgb(37, 99, 235);
                }
                else
                {
                    lblAirplaneStatus.Text = "👁️ ÉTAT : VISIBLE & ACTIF (Les élèves peuvent couper le Wi-Fi)";
                    lblAirplaneStatus.ForeColor = Color.FromArgb(71, 85, 105);

                    btnToggleAirplaneMode.Text = "🚫 MASQUER & DÉSACTIVER LE MODE AVION";
                    btnToggleAirplaneMode.BackColor = Color.FromArgb(220, 38, 38);
                }
            }
            catch (Exception ex)
            {
                statusLabel.Text = "Erreur lecture statut : " + ex.Message;
            }
        }

        private void ToggleWifiProtection()
        {
            string msg;
            this.Cursor = Cursors.WaitCursor;

            try
            {
                if (_isWifiProtected)
                {
                    bool ok = _controller.DisableWifiProtection(out msg);
                    statusLabel.Text = msg;
                    if (ok)
                    {
                        MessageBox.Show(
                            "La protection Wi-Fi a été désactivée.\nLes élèves et utilisateurs peuvent désormais voir et se connecter à tous les réseaux.",
                            "WiFi Lab Guardian",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                    else
                    {
                        MessageBox.Show(msg, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }
                else
                {
                    string target = _activeSsid;
                    if (string.IsNullOrEmpty(target))
                    {
                        var info = _controller.GetCurrentWifiInfo();
                        target = info.ConnectedSsid;
                    }

                    if (string.IsNullOrEmpty(target))
                    {
                        MessageBox.Show(
                            "Veuillez connecter votre ordinateur au réseau Wi-Fi du laboratoire avant d'activer la protection.",
                            "WiFi Lab Guardian",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Warning);
                        return;
                    }

                    bool ok = _controller.EnableWifiProtection(target, out msg);
                    statusLabel.Text = msg;
                    if (ok)
                    {
                        MessageBox.Show(
                            string.Format("Protection Wi-Fi ACTIVÉE avec succès sur \"{0}\".\n\n• Tous les autres réseaux Wi-Fi sont désormais bloqués et masqués.\n• La création de profils personnels non autorisés est verrouillée.", target),
                            "WiFi Lab Guardian",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                    else
                    {
                        MessageBox.Show(msg, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }
            }
            finally
            {
                this.Cursor = Cursors.Default;
                RefreshStatus();
            }
        }

        private void ToggleAirplaneMode()
        {
            if (!IsRunningAsAdmin())
            {
                MessageBox.Show(
                    this,
                    "Cette opération requiert des privilèges Administrateur.\nVeuillez relancer l'application en tant qu'administrateur.",
                    "Droits Administrateur Requis",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            string msg;
            this.Cursor = Cursors.WaitCursor;

            try
            {
                bool nextHide = !_isAirplaneHidden;
                bool ok = _controller.SetAirplaneModeHidden(nextHide, out msg);
                statusLabel.Text = msg;

                if (ok)
                {
                    string infoTitle = nextHide ? "Mode Avion Masqué & Neutralisé" : "Mode Avion Rétabli";
                    string promptRestart = nextHide
                        ? "Le Mode Avion a été MASQUÉ et DÉSACTIVÉ avec succès !\n\n" +
                          "• Service de gestion radio (RmSvc) : Désactivé\n" +
                          "• Tuile menu réseau (Barre des tâches) : Retirée\n" +
                          "• Raccourcis clavier (touches Fn) : Inopérants\n" +
                          "• Paramètres Windows : Page Mode Avion masquée\n\n" +
                          "Pour actualiser immédiatement le menu réseau de la barre des tâches sans redémarrer le PC, l'Explorateur Windows doit être rechargé.\n\n" +
                          "Souhaitez-vous redémarrer l'Explorateur Windows maintenant (recommandé) ?"
                        : "Le Mode Avion a été RÉTABLI avec succès !\n\n" +
                          "Pour actualiser immédiatement l'affichage dans la barre des tâches, souhaitez-vous recharger l'Explorateur Windows maintenant ?";

                    DialogResult dr = MessageBox.Show(this, promptRestart, infoTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                    if (dr == DialogResult.Yes)
                    {
                        ProtectionController.RestartExplorer();
                    }
                }
                else
                {
                    MessageBox.Show(this, msg, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            finally
            {
                this.Cursor = Cursors.Default;
                RefreshStatus();
            }
        }
    }
}
