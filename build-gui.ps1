<#
.SYNOPSIS
Script de compilation locale du panneau de contrôle Windows Native C# avec csc.exe
#>
$ErrorActionPreference = "Stop"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    Write-Error "Compilateur csc.exe (.NET Framework 4.x) introuvable sur le système."
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Compilation de WiFiLabGuardian.exe (.NET WinForms C#)   " -ForegroundColor Cyan
Write-Host " Compilateur : $csc" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$sources = Get-ChildItem -Path "src\desktop\*.cs" | Select-Object -ExpandProperty FullName

$iconParam = ""
if (Test-Path "build\icon.ico") {
    $iconParam = "/win32icon:build\icon.ico"
}

$manifestParam = ""
if (Test-Path "src\desktop\App.manifest") {
    $manifestParam = "/win32manifest:src\desktop\App.manifest"
}

& $csc /target:winexe `
       /platform:anycpu `
       /optimize+ `
       $manifestParam `
       $iconParam `
       /r:System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Web.Extensions.dll `
       /out:WiFiLabGuardian.exe `
       $sources

if ($LASTEXITCODE -eq 0 -and (Test-Path "WiFiLabGuardian.exe")) {
    $size = (Get-Item "WiFiLabGuardian.exe").Length
    Write-Host "`n[SUCCÈS] Exécutable généré : WiFiLabGuardian.exe ($size octets)" -ForegroundColor Green
    Write-Host "• Application : WiFi Lab Guardian (WinForms Native Shell)" -ForegroundColor Green
    Write-Host "• Zéro console/DOS window (Sous-système Windows GUI natif)" -ForegroundColor Green
    Write-Host "• Support System Tray & Contrôle WLAN intégrés" -ForegroundColor Green
} else {
    Write-Host "`n[ERREUR] Échec de compilation C#." -ForegroundColor Red
    exit 1
}

