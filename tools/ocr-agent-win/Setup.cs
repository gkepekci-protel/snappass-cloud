// SnapPass OCR Aracı — kurulum programı (tek exe; dosyalar içine gömülü payload.zip)
//   SnapPassOCR-Setup.exe                          kur / güncelle (servis: SnapPassOCR, otomatik başlar)
//   SnapPassOCR-Setup.exe --origins=https://a,https://b   izinli SnapPass adresleri
//   SnapPassOCR-Setup.exe --port=5102 --dir="C:\Program Files\SnapPass OCR" --quiet
//   SnapPassOCR-Setup.exe --uninstall              servisi ve dosyaları kaldır
//   SnapPassOCR-Setup.exe --extract-only --dir=... yalnız dosyaları aç (servis kaydı yok; test için)
//   "/x:deger" biçimi de kabul edilir; tanınmayan parametrede hiçbir işlem yapılmaz.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

public static class Setup
{
    const string ServiceName = "SnapPassOCR";
    const string DisplayName = "SnapPass OCR Aracı";
    const string DefaultOrigins = "https://snappass.protel.com.tr";

    static bool quiet;

    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "SnapPass OCR");
        string origins = null, port = null;
        bool uninstall = false, extractOnly = false;
        foreach (var raw in args)
        {
            // "/x", "-x" ve "--x" biçimleri; değer ":" ya da "=" ile (Git Bash "/x"i yol sanabildiği için "--x" önerilir)
            if (!(raw.StartsWith("/") || raw.StartsWith("-"))) return Fail("Tanınmayan parametre: " + raw);
            string a = raw.TrimStart('/', '-');
            int sep = a.IndexOfAny(new[] { ':', '=' });
            string key = (sep < 0 ? a : a.Substring(0, sep)).ToLowerInvariant();
            string val = sep < 0 ? "" : a.Substring(sep + 1).Trim('"');
            if (key == "dir") dir = val;
            else if (key == "origins") origins = val;
            else if (key == "port") port = val;
            else if (key == "uninstall") uninstall = true;
            else if (key == "extract-only") extractOnly = true;
            else if (key == "quiet") quiet = true;
            else return Fail("Tanınmayan parametre: " + raw);
        }

        try
        {
            if (!extractOnly && !IsAdmin()) return Fail("Kurulum yönetici olarak çalıştırılmalı (sağ tık > Yönetici olarak çalıştır).");
            if (uninstall) return Uninstall(dir);

            Say("SnapPass OCR Aracı kuruluyor: " + dir);
            if (!extractOnly) StopService();
            Extract(dir);
            WriteConfig(dir, origins, port);
            if (extractOnly) { Say("Dosyalar açıldı (servis kaydı yapılmadı)."); return Done(0); }

            string p = port ?? ReadPort(dir);
            // Eski servis durduruldu; port hâlâ doluysa başka bir program kullanıyordur (sağlık kontrolü yanıltmasın)
            if (PortInUse(p)) return Fail("Port " + p + " başka bir program tarafından kullanılıyor. O programı kapatın ya da --port=... ile başka port seçin.");
            RegisterService(dir);
            Sc("start " + ServiceName);
            Say("Araç başlatılıyor, kontrol ediliyor: http://127.0.0.1:" + p + "/health");
            if (!WaitHealthy(p, 60)) return Fail("Servis kuruldu ancak araç cevap vermedi. Günlük: " + Path.Combine(dir, "logs", "agent.log"));
            Say("Kurulum tamamlandı. Servis \"" + DisplayName + "\" Windows açılışında otomatik başlar.");
            return Done(0);
        }
        catch (Exception e) { return Fail(e.Message); }
    }

    static int Uninstall(string dir)
    {
        Say("SnapPass OCR Aracı kaldırılıyor...");
        StopService();
        if (ServiceExists()) Sc("delete " + ServiceName);
        Thread.Sleep(1500);
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Say("Kaldırıldı.");
        return Done(0);
    }

    static bool IsAdmin()
    {
        return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    }

    static bool ServiceExists()
    {
        foreach (var s in ServiceController.GetServices()) if (s.ServiceName.Equals(ServiceName, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    static void StopService()
    {
        if (!ServiceExists()) return;
        using (var sc = new ServiceController(ServiceName))
        {
            if (sc.Status != ServiceControllerStatus.Stopped)
            {
                Say("Çalışan servis durduruluyor...");
                sc.Stop();
                sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            }
        }
        Thread.Sleep(1000);
    }

    // Gömülü payload.zip'i hedef klasöre açar; var olan dosyaların üzerine yazar (config.json ve logs korunur)
    static void Extract(string dir)
    {
        using (var res = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
        {
            int n = 0;
            foreach (var entry in zip.Entries)
            {
                string target = Path.GetFullPath(Path.Combine(dir, entry.FullName));
                if (!target.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)) continue;
                if (string.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                entry.ExtractToFile(target, true);
                n++;
            }
            Say(n + " dosya açıldı.");
        }
    }

    static void WriteConfig(string dir, string origins, string port)
    {
        string file = Path.Combine(dir, "config.json");
        if (File.Exists(file) && origins == null && port == null) { Say("Mevcut ayarlar korundu: " + file); return; }
        string json = "{\n  \"port\": " + (port ?? "5102") + ",\n  \"origins\": \"" + (origins ?? DefaultOrigins).Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\n  \"workers\": 0\n}\n";
        File.WriteAllText(file, json, new UTF8Encoding(false));
        Say("Ayarlar yazıldı: " + file);
    }

    static string ReadPort(string dir)
    {
        try
        {
            var m = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(Path.Combine(dir, "config.json")), "\"port\"\\s*:\\s*(\\d+)");
            if (m.Success) return m.Groups[1].Value;
        }
        catch { }
        return "5102";
    }

    static bool PortInUse(string port)
    {
        try
        {
            var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, int.Parse(port));
            l.Start();
            l.Stop();
            return false;
        }
        catch { return true; }
    }

    static void RegisterService(string dir)
    {
        string exe = Path.Combine(dir, "SnapPassOcrService.exe");
        if (!ServiceExists())
        {
            Sc("create " + ServiceName + " binPath= \"\\\"" + exe + "\\\"\" start= auto DisplayName= \"" + DisplayName + "\"");
            Say("Servis kaydedildi: " + ServiceName);
        }
        else
        {
            Sc("config " + ServiceName + " binPath= \"\\\"" + exe + "\\\"\" start= auto");
        }
        Sc("description " + ServiceName + " \"Resepsiyon kamerasından kimlik/pasaport MRZ okuma (yalnız 127.0.0.1)\"");
        Sc("failure " + ServiceName + " reset= 86400 actions= restart/5000/restart/5000/restart/30000");
    }

    static void Sc(string args)
    {
        var p = Process.Start(new ProcessStartInfo("sc.exe", args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
        p.WaitForExit();
    }

    static bool WaitHealthy(string port, int seconds)
    {
        for (int i = 0; i < seconds; i++)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health");
                req.Timeout = 1500;
                using (var res = (HttpWebResponse)req.GetResponse()) if (res.StatusCode == HttpStatusCode.OK) return true;
            }
            catch { }
            Thread.Sleep(1000);
        }
        return false;
    }

    static void Say(string s) { Console.WriteLine(s); }
    static int Fail(string s) { Console.WriteLine("HATA: " + s); return Done(1); }
    static int Done(int code)
    {
        if (!quiet && Environment.UserInteractive) { Console.WriteLine(); Console.WriteLine("Kapatmak için Enter'a basın."); Console.ReadLine(); }
        return code;
    }
}
