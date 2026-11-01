// SnapPass OCR Aracı — Windows servisi sarmalayıcısı
// node.exe ocr-agent.js sürecini başlatır, düşerse yeniden başlatır, çıktısını logs\agent.log'a yazar.
// Ayarlar aynı klasördeki config.json'dan okunur: { "port": 5102, "origins": "...", "workers": 0 }
// Konsolda denemek için: SnapPassOcrService.exe /console
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public class SnapPassOcrService : ServiceBase
{
    public const string Name = "SnapPassOCR";

    readonly string baseDir = AppDomain.CurrentDomain.BaseDirectory;
    Process child;
    Thread supervisor;
    volatile bool stopping;

    public SnapPassOcrService() { ServiceName = Name; CanStop = true; CanShutdown = true; }

    protected override void OnStart(string[] args) { StartSupervisor(); }
    protected override void OnStop() { StopChild(); }
    protected override void OnShutdown() { StopChild(); }

    public void StartSupervisor()
    {
        stopping = false;
        supervisor = new Thread(Supervise) { IsBackground = true };
        supervisor.Start();
    }

    // Düşen süreci artan beklemeyle (en çok 60 sn) yeniden başlatır
    void Supervise()
    {
        int delay = 2000;
        while (!stopping)
        {
            DateTime started = DateTime.Now;
            try
            {
                RunChild();
                child.WaitForExit();
                Log("Arac kapandi (cikis kodu " + child.ExitCode + ")");
            }
            catch (Exception e) { Log("Baslatilamadi: " + e.Message); }
            if (stopping) break;
            if ((DateTime.Now - started).TotalMinutes > 5) delay = 2000;
            Thread.Sleep(delay);
            delay = Math.Min(delay * 2, 60000);
        }
    }

    void RunChild()
    {
        string config = File.Exists(Path.Combine(baseDir, "config.json")) ? File.ReadAllText(Path.Combine(baseDir, "config.json")) : "{}";
        var psi = new ProcessStartInfo(Path.Combine(baseDir, "node.exe"), "\"" + Path.Combine(baseDir, "app", "ocr-agent.js") + "\"")
        {
            WorkingDirectory = Path.Combine(baseDir, "app"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        string port = JsonValue(config, "port"), origins = JsonValue(config, "origins"), workers = JsonValue(config, "workers");
        if (port != "") psi.EnvironmentVariables["SNAPPASS_AGENT_PORT"] = port;
        if (origins != "") psi.EnvironmentVariables["SNAPPASS_AGENT_ORIGINS"] = origins;
        if (workers != "" && workers != "0") psi.EnvironmentVariables["SNAPPASS_OCR_WORKERS"] = workers;
        child = new Process { StartInfo = psi };
        child.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
        child.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
        child.Start();
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        Log("Arac baslatildi (PID " + child.Id + ")");
    }

    void StopChild()
    {
        stopping = true;
        try { if (child != null && !child.HasExited) { child.Kill(); child.WaitForExit(5000); } } catch { }
        Log("Servis durduruldu");
    }

    // Basit JSON değer okuma (dış kütüphane yok): "anahtar": "deger" ya da sayı
    static string JsonValue(string json, string key)
    {
        var m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|(-?\\d+))");
        if (!m.Success) return "";
        return m.Groups[2].Success && m.Groups[1].Value.StartsWith("\"") ? Regex.Unescape(m.Groups[2].Value) : m.Groups[3].Value;
    }

    readonly object logLock = new object();
    void Log(string line)
    {
        try
        {
            lock (logLock)
            {
                string dir = Path.Combine(baseDir, "logs");
                Directory.CreateDirectory(dir);
                string file = Path.Combine(dir, "agent.log");
                if (File.Exists(file) && new FileInfo(file).Length > 5 * 1024 * 1024)
                {
                    File.Copy(file, file + ".1", true);
                    File.Delete(file);
                }
                File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine, new UTF8Encoding(false));
            }
            if (Environment.UserInteractive) Console.WriteLine(line);
        }
        catch { }
    }

    public static void Main(string[] args)
    {
        if (args.Length > 0 && args[0].Equals("/console", StringComparison.OrdinalIgnoreCase))
        {
            var svc = new SnapPassOcrService();
            svc.StartSupervisor();
            Console.WriteLine("Konsol modunda calisiyor. Durdurmak icin Enter.");
            Console.ReadLine();
            svc.StopChild();
            return;
        }
        Run(new SnapPassOcrService());
    }
}
