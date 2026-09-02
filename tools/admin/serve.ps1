<#
    Запуск редактора розкладів (Windows PowerShell).

        powershell -ExecutionPolicy Bypass -File tools\admin\serve.ps1
        powershell -ExecutionPolicy Bypass -File tools\admin\serve.ps1 -Port 8080

    Сервер піднімається з КОРЕНЯ репозиторію — інакше адмінка не побачить
    docs\schedules\ (вона читає їх по відносному шляху ../../docs/schedules/).

    Якщо в системі є Python — запускаємо serve.py (там та сама логіка).
    Якщо немає — піднімаємо власний мінімальний сервер на TcpListener, щоб
    інструмент працював на чистій Windows без жодних установок.

    Обидва варіанти дають редактору write-API, щоб він писав розклади прямо
    в docs\schedules\:

        GET    /__admin/ping             -> {"write": true}
        PUT    /docs/schedules/<id>.json -> записати
        DELETE /docs/schedules/<id>.json -> видалити

    Обмеження навмисне жорсткі: слухаємо тільки 127.0.0.1, писати можна лише
    в docs\schedules\ і лише файли [A-Za-z0-9_-]+.json (без крапок і слешів,
    тому вийти з теки шаблоном неможливо), тіло — валідний JSON до 512 КБ.
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
        & $python (Join-Path $scriptDir 'serve.py') $Port
    } finally {
        Pop-Location
    }
    return
}

# ---------- варіант 2: власний сервер (без Python) ----------
Write-Host "Корінь:  $root"
Write-Host "Адмінка: $url"
Write-Host "Розклад: http://localhost:$Port/docs/"
Write-Host "Python не знайдено — використовую вбудований сервер PowerShell." -ForegroundColor Yellow
Write-Host "Запис у docs\schedules\ увімкнено"
Write-Host "Ctrl+C — зупинити"

$schedulesDir = Join-Path $root 'docs\schedules'
$maxBody = 512 * 1024

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

function Send-Json {
    param($Stream, [int]$Code, [string]$Status, $Object)
    $json = $Object | ConvertTo-Json -Compress
    Send-Response $Stream $Code $Status 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
}

# Шукає порожній рядок (CRLFCRLF), що відділяє заголовки від тіла.
function Find-HeaderEnd {
    param([byte[]]$Bytes, [int]$Count)
    for ($i = 0; $i -le $Count - 4; $i++) {
        if ($Bytes[$i] -eq 13 -and $Bytes[$i+1] -eq 10 -and $Bytes[$i+2] -eq 13 -and $Bytes[$i+3] -eq 10) { return $i }
    }
    return -1
}

# Читаємо запит сирими байтами: заголовки — ASCII, тіло — UTF-8.
# Через StreamReader тіло з кирилицею б'ється, тому так.
function Read-Request {
    param($Stream)
    $ms = New-Object System.IO.MemoryStream
    $buf = New-Object byte[] 8192
    $headerEnd = -1
    while ($headerEnd -lt 0) {
        $n = $Stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { return $null }
        $ms.Write($buf, 0, $n)
        $arr = $ms.ToArray()
        $headerEnd = Find-HeaderEnd $arr $arr.Length
        if ($ms.Length -gt $maxBody + 65536) { return $null }
    }
    $arr = $ms.ToArray()
    $headerText = [Text.Encoding]::ASCII.GetString($arr, 0, $headerEnd)
    $lines = $headerText -split "`r`n"

    $contentLength = 0
    foreach ($line in $lines) {
        if ($line -match '^(?i)content-length:\s*(\d+)\s*$') { $contentLength = [int]$Matches[1] }
    }
    if ($contentLength -gt $maxBody) { return $null }

    $bodyStart = $headerEnd + 4
    $have = $arr.Length - $bodyStart
    while ($have -lt $contentLength) {
        $n = $Stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $ms.Write($buf, 0, $n)
        $have = $ms.Length - $bodyStart
    }
    $arr = $ms.ToArray()

    $body = ''
    if ($contentLength -gt 0 -and $arr.Length -ge $bodyStart + $contentLength) {
        $body = [Text.Encoding]::UTF8.GetString($arr, $bodyStart, $contentLength)
    }
    return @{ RequestLine = $lines[0]; Body = $body }
}

# Шлях на диску для write-запиту, або $null якщо запит не дозволений.
function Resolve-ScheduleTarget {
    param([string]$UrlPath)
    if ($UrlPath -notmatch '^/docs/schedules/([^/]+)$') { return $null }
    $name = [System.Uri]::UnescapeDataString($Matches[1])
    if ($name -notmatch '^[A-Za-z0-9_-]+\.json$') { return $null }
    $full = [IO.Path]::GetFullPath((Join-Path $schedulesDir $name))
    if ([IO.Path]::GetDirectoryName($full) -ne [IO.Path]::GetFullPath($schedulesDir)) { return $null }
    return $full
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $req = Read-Request $stream
            if ($null -eq $req) { continue }

            $parts = $req.RequestLine.Split(' ')
            if ($parts.Count -lt 2) { continue }
            $method = $parts[0].ToUpper()
            $rawPath = $parts[1].Split('?')[0]
            $decoded = [System.Uri]::UnescapeDataString($rawPath)

            # ---- write-API ----
            if ($method -eq 'PUT' -or $method -eq 'DELETE') {
                $target = Resolve-ScheduleTarget $rawPath
                if (-not $target) {
                    Send-Json $stream 403 'Forbidden' @{ error = 'дозволено лише docs/schedules/<id>.json' }
                    continue
                }
                if ($method -eq 'PUT') {
                    try { $null = $req.Body | ConvertFrom-Json }
                    catch {
                        Send-Json $stream 400 'Bad Request' @{ error = 'невалідний JSON' }
                        continue
                    }
                    try {
                        $null = New-Item -ItemType Directory -Force -Path $schedulesDir
                        $tmp = "$target.tmp"
                        # без BOM — інакше JSON.parse у браузері спіткнеться
                        [IO.File]::WriteAllText($tmp, $req.Body, (New-Object Text.UTF8Encoding($false)))
                        Move-Item -LiteralPath $tmp -Destination $target -Force
                    } catch {
                        Send-Json $stream 500 'Internal Server Error' @{ error = $_.Exception.Message }
                        continue
                    }
                    Write-Host "  записано docs\schedules\$([IO.Path]::GetFileName($target))"
                    Send-Json $stream 200 'OK' @{ ok = $true }
                } else {
                    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
                        Send-Json $stream 404 'Not Found' @{ error = 'файла немає' }
                        continue
                    }
                    try { Remove-Item -LiteralPath $target -Force }
                    catch {
                        Send-Json $stream 500 'Internal Server Error' @{ error = $_.Exception.Message }
                        continue
                    }
                    Write-Host "  видалено docs\schedules\$([IO.Path]::GetFileName($target))"
                    Send-Json $stream 200 'OK' @{ ok = $true }
                }
                continue
            }

            if ($method -ne 'GET') {
                Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Only GET/PUT/DELETE'))
                continue
            }

            if ($decoded -eq '/__admin/ping') {
                Send-Json $stream 200 'OK' @{ write = $true; root = $root; dir = 'docs/schedules' }
                continue
            }

            # ---- статика ----
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
