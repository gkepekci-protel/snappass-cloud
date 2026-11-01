# SnapPass PMS yazma denemesi (Oracle Forms test ortami icin). Kaydetmez, yalnizca 3 alana ayni metni 3 yontemle yazar.
# Kullanim:
#   1) PMS TEST ortaminda bir profili ac, imleci SOYAD alanina birak.
#   2) powershell -ExecutionPolicy Bypass -File pms-typing-test.ps1
#   3) Betik "HAZIR" der; Gecikme (varsayilan 6 sn) icinde PMS penceresine tikla, imleci Soyad alaninda tut.
#   4) Alan 1: Unicode klavye gonderimi, Tab, Alan 2: panodan yapistir (Ctrl+V), Tab, Alan 3: sanal tus kodlari. Her alanda ne yazildigina bak.
# Betik ASCII'dir (PowerShell 5.1 Turkce karakterde bozulmasin diye); Turkce harfler kod numarasindan uretilir.
param(
  [int]$Delay = 6,
  [int]$KeyMs = 15,    # tus basimlari arasi bekleme (ms)
  [int]$TabMs = 400    # Tab sonrasi bekleme (ms): Forms alan dogrulamasi icin
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Kb {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public long pad1; [FieldOffset(8)] public long pad2; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  const uint KEYUP = 0x0002, UNICODE = 0x0004;
  static void Send(ushort vk, ushort scan, uint flags) {
    INPUT[] i = new INPUT[1]; i[0].type = 1; i[0].u.ki.wVk = vk; i[0].u.ki.wScan = scan; i[0].u.ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void UnicodeChar(char c) { Send(0, c, UNICODE); Send(0, c, UNICODE | KEYUP); }
  public static void Vk(ushort vk) { Send(vk, 0, 0); Send(vk, 0, KEYUP); }
  public static bool VkChar(char c) { short r = VkKeyScan(c); if (r == -1) return false; byte vk = (byte)(r & 0xff); bool shift = (r & 0x100) != 0;
    if (shift) Send(0x10, 0, 0); Vk(vk); if (shift) Send(0x10, 0, KEYUP); return true; }
  public static void Ctrl(ushort vk) { Send(0x11, 0, 0); Vk(vk); Send(0x11, 0, KEYUP); }
  public static string Title() { StringBuilder s = new StringBuilder(256); GetWindowText(GetForegroundWindow(), s, 256); return s.ToString(); }
}
"@
Add-Type -AssemblyName System.Windows.Forms

# Turkce harfler kod numarasindan (dosya ASCII kalsin)
$tr = -join ([char]0x00C7,[char]0x011E,[char]0x0130,[char]0x00D6,[char]0x015E,[char]0x00DC,' ',[char]0x00E7,[char]0x011F,[char]0x0131,[char]0x00F6,[char]0x015F,[char]0x00FC)
$text = "$tr TEST 123"

Write-Host "HAZIR. $Delay sn icinde PMS TEST penceresine tikla; imlec SOYAD alaninda kalsin."
Write-Host "Yazilacak metin (3 kez): $text"
Start-Sleep -Seconds $Delay
Write-Host ("On plandaki pencere: " + [Kb]::Title())

# Alan 1: Unicode
foreach ($c in $text.ToCharArray()) { [Kb]::UnicodeChar($c); Start-Sleep -Milliseconds $KeyMs }
[Kb]::Vk(0x09); Start-Sleep -Milliseconds $TabMs   # Tab

# Alan 2: pano + Ctrl+V
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 100
[Kb]::Ctrl(0x56); Start-Sleep -Milliseconds 200
[Kb]::Vk(0x09); Start-Sleep -Milliseconds $TabMs

# Alan 3: sanal tus kodlari (Turkce klavye duzeni acik degilse Turkce harfler yazilamaz)
$miss = @()
foreach ($c in $text.ToCharArray()) { if (-not [Kb]::VkChar($c)) { $miss += $c }; Start-Sleep -Milliseconds $KeyMs }
Write-Host "BITTI. Sanal tus yonteminde yazilamayan karakterler: $($miss -join ' ')"
Write-Host "Simdi 3 alanda ne yazildigini kontrol et (Unicode / Yapistir / Sanal tus). Kaydetme: bu betik Kaydet tusuna basmaz."
