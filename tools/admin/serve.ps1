<#
    Запуск редактора розкладів (Windows PowerShell).

        powershell -ExecutionPolicy Bypass -File tools\admin\serve.ps1
        powershell -ExecutionPolicy Bypass -File tools\admin\serve.ps1 -Port 8080

    Сервер піднімається з КОРЕНЯ репозиторію — інакше адмінка не побачить
    docs\schedules\ (вона читає їх по відносному шляху ../../docs/schedules/).

    Якщо в системі є Python — використовуємо http.server. Якщо немає —
    піднімаємо власний мінімальний статичний сервер на TcpListener, щоб
    інструмент працював на чистій Windows без жодних установок.
#>

param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

# ---------- корінь репозиторію ----------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = $null
try {
    $root = (& git -C $scriptDir rev-parse --show-toplevel 2>$null)
} catch { }
if ([string]::IsNullOrWhiteSpace($root)) {
    $root = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
} else {
    $root = (Resolve-Path $root.Trim()).Path
}

$url = "http://localhost:$Port/tools/admin/"

Write-Host "Корінь:  $root"
Write-Host "Адмінка: $url"
Write-Host "Розклад: http://localhost:$Port/docs/"
Write-Host "Ctrl+C — зупинити"

Start-Job -ScriptBlock {
    param($u)
    Start-Sleep -Seconds 1
    Start-Process $u
} -ArgumentList $url | Out-Null

# ---------- варіант 1: Python ----------
$python = $null
foreach ($candidate in @('python', 'py', 'python3')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source; break }
}

if ($python) {
    Push-Location $root
    try {
        & $python -m http.server $Port
    } finally {
        Pop-Location
    }
    return
}

# ---------- варіант 2: власний сервер (без Python) ----------
Write-Host "Python не знайдено — використовую вбудований сервер PowerShell." -ForegroundColor Yellow

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
}

function Send-Response {
    param($Stream, [int]$Code, [string]$Status, [string]$ContentType, [byte[]]$Body)
    $head = "HTTP/1.1 $Code $Status`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "Connection: close`r`n`r`n"
    $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
    $Stream.Write($headBytes, 0, $headBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
            while ($true) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or $line -eq '') { break }
            }

            $parts = $requestLine.Split(' ')
            if ($parts.Count -lt 2 -or $parts[0] -ne 'GET') {
                Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Only GET'))
                continue
            }

            $rawPath = $parts[1].Split('?')[0]
            $decoded = [System.Uri]::UnescapeDataString($rawPath)
            if ($decoded.EndsWith('/')) { $decoded += 'index.html' }
            $relative = $decoded.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)

            $full = [IO.Path]::GetFullPath((Join-Path $root $relative))

            # не випускаємо за межі кореня репозиторію
            if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))
                continue
            }

            if (Test-Path -LiteralPath $full -PathType Container) {
                $full = Join-Path $full 'index.html'
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes("404: $decoded"))
                continue
            }

            $ext = [IO.Path]::GetExtension($full).ToLower()
            $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
            $bytes = [IO.File]::ReadAllBytes($full)
            Send-Response $stream 200 'OK' $type $bytes
        } catch {
            Write-Host "Помилка запиту: $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
