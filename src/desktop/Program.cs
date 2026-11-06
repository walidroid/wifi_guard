using System;
using System.Threading;
using System.Windows.Forms;

namespace WiFiLabGuardian
{
    static class Program
    {
        private static Mutex _appMutex;

        [STAThread]
        static void Main()
        {
            bool createdNew;
            _appMutex = new Mutex(true, "Global\\WiFiLabGuardian_SingleInstance_Mutex", out createdNew);

            if (!createdNew)
            {
                MessageBox.Show(
                    "Une instance de WiFi Lab Guardian est déjà en cours d'exécution.\nVérifiez la zone de notification (près de l'horloge Windows).",
                    "WiFi Lab Guardian",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());

            GC.KeepAlive(_appMutex);
        }
    }
}

