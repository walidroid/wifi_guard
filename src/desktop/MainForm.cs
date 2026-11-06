using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace WiFiLabGuardian
{
    public class MainForm : Form
    {
        private ServerProcessManager _serverMgr;
        private JavaScriptSerializer _json;
        private Timer _statusTimer;

        // UI Controls
        private Panel pnlHeader;
        private Label lblTitle;
        private Label lblSubtitle;
        private Label lblStatusBadge;

        private Panel pnlToolbar;
        private Label lblPort;
        private NumericUpDown numPort;
        private Button btnStart;
        private Button btnStop;
        private Button btnOpenWeb;
        private Button btnToggleProtection;

        private GroupBox grpInfo;
        private Label lblActiveUrl;
        private LinkLabel lnkUrl;
        private Button btnCopyUrl;
        private Label lblProtectionState;
        private Label lblAdapterInfo;

        private GroupBox grpLogs;
        private TextBox txtLogs;
        private Button btnClearLogs;

        private NotifyIcon notifyIcon;
        private ContextMenuStrip trayMenu;
        private ToolStripMenuItem trayOpenWeb;
        private ToolStripMenuItem trayShowForm;
        private ToolStripMenuItem trayToggleProtection;
        private ToolStripMenuItem trayExit;

        private bool _isProtected = false;

        public MainForm()
        {
            _serverMgr = new ServerProcessManager();
            _json = new JavaScriptSerializer();

            InitializeComponent();

            _serverMgr.OnLogReceived += (log) =>
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(() => AppendLog(log)));
                }
                else
                {
                    AppendLog(log);
                }
            };

            _serverMgr.OnServerStopped += () =>
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(HandleServerStopped));
                }
                else
                {
                    HandleServerStopped();
                }
            };

            _statusTimer = new Timer();
            _statusTimer.Interval = 3000;
            _statusTimer.Tick += (s, e) => PollServerStatus();

            // Auto-démarrage du serveur local au lancement de l'application
            StartServerProcess();
        }

        private void InitializeComponent()
        {
            this.Text = "WiFi Lab Guardian — Contrôleur Windows Native WinForms";
            this.Size = new Size(760, 560);
            this.MinimumSize = new Size(700, 500);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(244, 246, 249);
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
                Height = 70,
                BackColor = Color.FromArgb(24, 30, 42),
                Padding = new Padding(16, 12, 16, 12)
            };

            lblTitle = new Label
            {
                Text = "🛡️ WiFi Lab Guardian",
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(16, 12)
            };

            lblSubtitle = new Label
            {
                Text = "Protection & Administration Wi-Fi Salle Informatique (Win32 Native WLAN)",
                ForeColor = Color.FromArgb(160, 174, 192),
                Font = new Font("Segoe UI", 8.5F),
                AutoSize = true,
                Location = new Point(18, 38)
            };

            lblStatusBadge = new Label
            {
                Text = "⚪ Serveur Arrêté",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(160, 174, 192),
                BackColor = Color.FromArgb(45, 55, 72),
                TextAlign = ContentAlignment.MiddleCenter,
                Size = new Size(180, 30),
                Location = new Point(540, 20),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };

            pnlHeader.Controls.Add(lblTitle);
            pnlHeader.Controls.Add(lblSubtitle);
            pnlHeader.Controls.Add(lblStatusBadge);

            // 2. Toolbar Panel
            pnlToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 52,
                BackColor = Color.White,
                Padding = new Padding(16, 10, 16, 10)
            };

            lblPort = new Label
            {
                Text = "Port :",
                AutoSize = true,
                Location = new Point(16, 16)
            };

            numPort = new NumericUpDown
            {
                Minimum = 1024,
                Maximum = 65535,
                Value = 4567,
                Location = new Point(60, 13),
                Width = 75
            };

            btnStart = new Button
            {
                Text = "▶ Démarrer",
                Size = new Size(100, 30),
                Location = new Point(145, 10),
                BackColor = Color.FromArgb(46, 133, 64),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnStart.FlatAppearance.BorderSize = 0;
            btnStart.Click += (s, e) => StartServerProcess();

            btnStop = new Button
            {
                Text = "⏹ Arrêter",
                Size = new Size(90, 30),
                Location = new Point(252, 10),
                BackColor = Color.FromArgb(197, 48, 48),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Enabled = false,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnStop.FlatAppearance.BorderSize = 0;
            btnStop.Click += (s, e) => StopServerProcess();

            btnOpenWeb = new Button
            {
                Text = "🌐 Ouvrir l'Interface Web",
                Size = new Size(180, 30),
                Location = new Point(350, 10),
                BackColor = Color.FromArgb(43, 108, 176),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnOpenWeb.FlatAppearance.BorderSize = 0;
            btnOpenWeb.Click += (s, e) => OpenWebInterface();

            btnToggleProtection = new Button
            {
                Text = "🔒 Protection",
                Size = new Size(140, 30),
                Location = new Point(538, 10),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                BackColor = Color.FromArgb(74, 85, 104),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnToggleProtection.FlatAppearance.BorderSize = 0;
            btnToggleProtection.Click += (s, e) => ToggleProtectionAction();

            pnlToolbar.Controls.Add(lblPort);
            pnlToolbar.Controls.Add(numPort);
            pnlToolbar.Controls.Add(btnStart);
            pnlToolbar.Controls.Add(btnStop);
            pnlToolbar.Controls.Add(btnOpenWeb);
            pnlToolbar.Controls.Add(btnToggleProtection);

            // 3. Info GroupBox
            grpInfo = new GroupBox
            {
                Text = " État du Service & Accès Local ",
                Location = new Point(16, 132),
                Size = new Size(712, 100),
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
                BackColor = Color.White,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };

            lblActiveUrl = new Label
            {
                Text = "Adresse Locale :",
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                Location = new Point(16, 25),
                AutoSize = true
            };

            lnkUrl = new LinkLabel
            {
                Text = "http://localhost:4567/",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Location = new Point(130, 25),
                AutoSize = true
            };
            lnkUrl.LinkClicked += (s, e) => OpenWebInterface();

            btnCopyUrl = new Button
            {
                Text = "📋 Copier",
                Size = new Size(70, 24),
                Location = new Point(310, 21),
                Font = new Font("Segoe UI", 8F),
                Cursor = Cursors.Hand
            };
            btnCopyUrl.Click += (s, e) =>
            {
                try
                {
                    Clipboard.SetText(lnkUrl.Text);
                    MessageBox.Show("Adresse copiée dans le presse-papiers !", "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch { }
            };

            lblProtectionState = new Label
            {
                Text = "Protection Wi-Fi : Inactive (Tous réseaux autorisés)",
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(113, 128, 150),
                Location = new Point(16, 50),
                AutoSize = true
            };

            lblAdapterInfo = new Label
            {
                Text = "Carte réseau Wi-Fi : Détection en cours...",
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(74, 85, 104),
                Location = new Point(16, 72),
                AutoSize = true
            };

            grpInfo.Controls.Add(lblActiveUrl);
            grpInfo.Controls.Add(lnkUrl);
            grpInfo.Controls.Add(btnCopyUrl);
            grpInfo.Controls.Add(lblProtectionState);
            grpInfo.Controls.Add(lblAdapterInfo);

            // 4. Logs GroupBox
            grpLogs = new GroupBox
            {
                Text = " Journal des Événements & Processus ",
                Location = new Point(16, 242),
                Size = new Size(712, 260),
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                BackColor = Color.White,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };

            txtLogs = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.FromArgb(24, 24, 27),
                ForeColor = Color.FromArgb(228, 228, 231),
                Font = new Font("Consolas", 9F),
                Location = new Point(16, 24),
                Size = new Size(680, 195),
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
            };

            btnClearLogs = new Button
            {
                Text = "Effacer le journal",
                Size = new Size(120, 26),
                Location = new Point(576, 224),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Right,
                Font = new Font("Segoe UI", 8.5F),
                Cursor = Cursors.Hand
            };
            btnClearLogs.Click += (s, e) => txtLogs.Clear();

            grpLogs.Controls.Add(txtLogs);
            grpLogs.Controls.Add(btnClearLogs);

            this.Controls.Add(grpLogs);
            this.Controls.Add(grpInfo);
            this.Controls.Add(pnlToolbar);
            this.Controls.Add(pnlHeader);

            // 5. System Tray & Context Menu
            trayMenu = new ContextMenuStrip();
            trayOpenWeb = new ToolStripMenuItem("🌐 Ouvrir l'Interface Web", null, (s, e) => OpenWebInterface());
            trayShowForm = new ToolStripMenuItem("🖥️ Panneau de Contrôle", null, (s, e) => RestoreWindow());
            trayToggleProtection = new ToolStripMenuItem("🔒 Basculer la Protection", null, (s, e) => ToggleProtectionAction());
            trayExit = new ToolStripMenuItem("❌ Quitter WiFi Lab Guardian", null, (s, e) => Application.Exit());

            trayMenu.Items.Add(trayOpenWeb);
            trayMenu.Items.Add(trayShowForm);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(trayToggleProtection);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(trayExit);

            notifyIcon = new NotifyIcon
            {
                Text = "WiFi Lab Guardian",
                Visible = true,
                ContextMenuStrip = trayMenu
            };
            try { notifyIcon.Icon = this.Icon; } catch { }
            notifyIcon.DoubleClick += (s, e) => RestoreWindow();

            this.FormClosing += MainForm_FormClosing;
        }

        private void StartServerProcess()
        {
            if (_serverMgr.IsRunning) return;

            int port = (int)numPort.Value;
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string err;

            AppendLog(string.Format("[SYSTEM] Démarrage du serveur local sur le port {0}...", port));

            if (_serverMgr.StartServer(appDir, port, out err))
            {
                btnStart.Enabled = false;
                numPort.Enabled = false;
                btnStop.Enabled = true;
                lblStatusBadge.Text = string.Format("🟢 En Ligne (Port {0})", port);
                lblStatusBadge.BackColor = Color.FromArgb(46, 133, 64);
                lblStatusBadge.ForeColor = Color.White;
                lnkUrl.Text = string.Format("http://localhost:{0}/", port);
                AppendLog(string.Format("[SYSTEM] Serveur local actif sur {0}", lnkUrl.Text));
                _statusTimer.Start();
            }
            else
            {
                AppendLog("[ERREUR] " + err);
                MessageBox.Show(err, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopServerProcess()
        {
            _statusTimer.Stop();
            _serverMgr.StopServer();
            HandleServerStopped();
        }

        private void HandleServerStopped()
        {
            btnStart.Enabled = true;
            numPort.Enabled = true;
            btnStop.Enabled = false;
            lblStatusBadge.Text = "⚪ Serveur Arrêté";
            lblStatusBadge.BackColor = Color.FromArgb(45, 55, 72);
            lblStatusBadge.ForeColor = Color.FromArgb(160, 174, 192);
            lblProtectionState.Text = "Protection Wi-Fi : Inactive (Serveur arrêté)";
            lblProtectionState.ForeColor = Color.FromArgb(113, 128, 150);
            AppendLog("[SYSTEM] Serveur local arrêté.");
        }

        private void OpenWebInterface()
        {
            try
            {
                string url = lnkUrl.Text;
                Process.Start(url);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Impossible d'ouvrir le navigateur : " + ex.Message, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void RestoreWindow()
        {
            this.WindowState = FormWindowState.Normal;
            this.Show();
            this.BringToFront();
        }

        private void ToggleProtectionAction()
        {
            if (!_serverMgr.IsRunning)
            {
                MessageBox.Show("Le serveur doit être démarré pour basculer la protection.", "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                string endpoint = _isProtected ? "/api/protection/disable" : "/api/protection/enable";
                string url = string.Format("http://localhost:{0}{1}", _serverMgr.CurrentPort, endpoint);

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";

                string payload = _isProtected ? "{}" : "{\"autoConnect\":true,\"reconnectOnDisconnect\":true,\"hideBlockedNetworks\":true,\"blockAdhocNetworks\":true}";
                byte[] data = Encoding.UTF8.GetBytes(payload);
                req.ContentLength = data.Length;

                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(data, 0, data.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                {
                    string json = reader.ReadToEnd();
                    AppendLog(string.Format("[PROTECTION] Réponse : {0}", json));
                    PollServerStatus();
                }
            }
            catch (Exception ex)
            {
                AppendLog(string.Format("[PROTECTION ERROR] {0}", ex.Message));
                MessageBox.Show("Erreur lors du basculement : " + ex.Message, "WiFi Lab Guardian", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void PollServerStatus()
        {
            if (!_serverMgr.IsRunning) return;

            try
            {
                string url = string.Format("http://localhost:{0}/api/status", _serverMgr.CurrentPort);
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 2000;
                req.Method = "GET";

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                {
                    string json = reader.ReadToEnd();
                    dynamic res = _json.Deserialize<dynamic>(json);

                    bool protectedState = false;
                    if (res.ContainsKey("protectionEnabled"))
                    {
                        protectedState = Convert.ToBoolean(res["protectionEnabled"]);
                    }

                    _isProtected = protectedState;

                    if (_isProtected)
                    {
                        string ssid = res.ContainsKey("targetSsid") ? Convert.ToString(res["targetSsid"]) : "Laboratoire";
                        lblProtectionState.Text = string.Format("Protection Wi-Fi : 🔒 ACTIVE (Seul le réseau \"{0}\" est autorisé)", ssid);
                        lblProtectionState.ForeColor = Color.FromArgb(46, 133, 64);
                        btnToggleProtection.Text = "🔓 Désactiver";
                        btnToggleProtection.BackColor = Color.FromArgb(197, 48, 48);
                    }
                    else
                    {
                        lblProtectionState.Text = "Protection Wi-Fi : Inactive (Tous réseaux visibles et autorisés)";
                        lblProtectionState.ForeColor = Color.FromArgb(113, 128, 150);
                        btnToggleProtection.Text = "🔒 Activer";
                        btnToggleProtection.BackColor = Color.FromArgb(46, 133, 64);
                    }

                    if (res.ContainsKey("primaryInterface") && res["primaryInterface"] != null)
                    {
                        var iface = res["primaryInterface"];
                        string desc = iface.ContainsKey("description") ? Convert.ToString(iface["description"]) : "Carte Wi-Fi";
                        string state = iface.ContainsKey("state") ? Convert.ToString(iface["state"]) : "Inconnu";
                        string connSsid = iface.ContainsKey("connectedSsid") ? Convert.ToString(iface["connectedSsid"]) : "";
                        lblAdapterInfo.Text = string.Format("Carte Wi-Fi : {0} ({1}{2})", desc, state, string.IsNullOrEmpty(connSsid) ? "" : " • " + connSsid);
                    }
                }
            }
            catch { }
        }

        private void AppendLog(string message)
        {
            try
            {
                string line = string.Format("[{0}] {1}\r\n", DateTime.Now.ToString("HH:mm:ss"), message);
                txtLogs.AppendText(line);
            }
            catch { }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                DialogResult res = MessageBox.Show(
                    "Voulez-vous réduire WiFi Lab Guardian dans la zone de notification (près de l'horloge) pour maintenir la protection active en arrière-plan ?\n\n• Cliquez sur OUI pour minimiser dans la barre des tâches.\n• Cliquez sur NON pour quitter complètement l'application.",
                    "WiFi Lab Guardian",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Question);

                if (res == DialogResult.Yes)
                {
                    e.Cancel = true;
                    this.Hide();
                    notifyIcon.ShowBalloonTip(
                        3000,
                        "WiFi Lab Guardian",
                        "L'application continue de surveiller et protéger la salle en arrière-plan.",
                        ToolTipIcon.Info);
                    return;
                }
                else if (res == DialogResult.Cancel)
                {
                    e.Cancel = true;
                    return;
                }
            }

            // Arrêt propre
            _statusTimer.Stop();
            _serverMgr.StopServer();
            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }
        }
    }
}

