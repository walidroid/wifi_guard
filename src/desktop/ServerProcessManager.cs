using System;
using System.Diagnostics;
using System.IO;

namespace WiFiLabGuardian
{
    public class ServerProcessManager
    {
        private Process _nodeProcess;
        public int CurrentPort { get; private set; }
        public bool IsRunning { get { return _nodeProcess != null && !_nodeProcess.HasExited; } }

        public event Action<string> OnLogReceived;
        public event Action OnServerStopped;

        public string FindNodeExecutable(string baseDirectory)
        {
            // 1. Recherche dans bin\node.exe (intégré par l'installateur Inno Setup)
            string localBin = Path.Combine(baseDirectory, "bin", "node.exe");
            if (File.Exists(localBin)) return localBin;

            // 2. Recherche à la racine de l'application
            string rootNode = Path.Combine(baseDirectory, "node.exe");
            if (File.Exists(rootNode)) return rootNode;

            // 3. Recherche dans le PATH système de Windows
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var part in pathEnv.Split(';'))
            {
                if (string.IsNullOrEmpty(part)) continue;
                try
                {
                    string candidate = Path.Combine(part.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            return null;
        }

        public string FindServerScript(string baseDirectory)
        {
            string serverPath = Path.Combine(baseDirectory, "server.js");
            if (File.Exists(serverPath)) return serverPath;

            // Fallback dans le dossier parent (mode développement src\desktop\)
            string parentPath = Path.Combine(baseDirectory, "..", "server.js");
            if (File.Exists(parentPath)) return Path.GetFullPath(parentPath);

            string grandparentPath = Path.Combine(baseDirectory, "..", "..", "server.js");
            if (File.Exists(grandparentPath)) return Path.GetFullPath(grandparentPath);

            return null;
        }

        public bool StartServer(string baseDirectory, int port, out string error)
        {
            error = null;

            if (IsRunning)
            {
                error = string.Format("Le serveur fonctionne déjà sur le port {0}.", CurrentPort);
                return false;
            }

            string nodeExe = FindNodeExecutable(baseDirectory);
            if (string.IsNullOrEmpty(nodeExe))
            {
                error = "Exécutable 'node.exe' introuvable. Veuillez réinstaller l'application ou vérifier les fichiers du programme.";
                return false;
            }

            string serverJs = FindServerScript(baseDirectory);
            if (string.IsNullOrEmpty(serverJs))
            {
                error = "Fichier 'server.js' introuvable dans le répertoire de l'application.";
                return false;
            }

            try
            {
                CurrentPort = port;
                string scriptDirectory = Path.GetDirectoryName(serverJs);

                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = string.Format("\"{0}\" --port={1}", serverJs, port),
                    WorkingDirectory = scriptDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                psi.EnvironmentVariables["PORT"] = port.ToString();

                _nodeProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };

                _nodeProcess.OutputDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        var handler = OnLogReceived;
                        if (handler != null) handler(e.Data);
                    }
                };

                _nodeProcess.ErrorDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        var handler = OnLogReceived;
                        if (handler != null) handler("[ERR] " + e.Data);
                    }
                };

                _nodeProcess.Exited += (s, e) =>
                {
                    var handler = OnServerStopped;
                    if (handler != null) handler();
                };

                bool started = _nodeProcess.Start();
                if (started)
                {
                    _nodeProcess.BeginOutputReadLine();
                    _nodeProcess.BeginErrorReadLine();
                    return true;
                }
                else
                {
                    error = "Échec du démarrage du processus Node.js.";
                    return false;
                }
            }
            catch (Exception ex)
            {
                error = "Exception au démarrage du serveur : " + ex.Message;
                return false;
            }
        }

        public void StopServer()
        {
            if (_nodeProcess == null) return;

            try
            {
                if (!_nodeProcess.HasExited)
                {
                    // Tente une fermeture propre, puis force l'arrêt de l'arborescence
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = "taskkill",
                            Arguments = string.Format("/PID {0} /T /F", _nodeProcess.Id),
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        Process.Start(psi);
                    }
                    catch
                    {
                        _nodeProcess.Kill();
                    }
                }
            }
            catch { }
            finally
            {
                try { _nodeProcess.Dispose(); } catch { }
                _nodeProcess = null;
            }
        }
    }
}

