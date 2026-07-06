$traceFile = "C:\\PersonalRepo\\.planning\\traces.jsonl"
$clearString = [char]27 + "[2J" + [char]27 + "[H"

while ($true) {
    Write-Host -NoNewline $clearString
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host "               LIVE SWARM DASHBOARD (2026 OTel Architecture)                    " -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host "================================================================================`n" -ForegroundColor Cyan

    if (Test-Path $traceFile) {
        # Read the last 15 lines so the dashboard doesn't overflow
        $rawLines = Get-Content -Path $traceFile -Tail 15 -ErrorAction SilentlyContinue
        
        $logs = @()
        foreach ($line in $rawLines) {
            try {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $logs += $line | ConvertFrom-Json -ErrorAction Stop
                }
            } catch {
                # Skip invalid JSON lines
            }
        }
        
        if ($logs.Count -gt 0) {
            $formattedLogs = foreach ($log in $logs) {
                $reason = $log.reasoning_path
                if ($null -ne $reason -and $reason.Length -gt 60) {
                    $reason = $reason.Substring(0,57) + "..."
                }

                [PSCustomObject]@{
                    Time    = [datetime]::Parse($log.timestamp).ToString("HH:mm:ss")
                    Span    = if ($log.span_id) { $log.span_id } else { "N/A" }
                    Persona = if ($log.persona) { $log.persona } else { "Unknown" }
                    Action  = if ($log.action_type) { $log.action_type } else { "Unknown" }
                    Tokens  = if ($log.metrics.total_tokens) { $log.metrics.total_tokens } else { 0 }
                    Reasoning = $reason
                }
            }
            $formattedLogs | Format-Table -AutoSize
        } else {
            Write-Host "No valid traces found yet." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Waiting for traces... ($traceFile not found)" -ForegroundColor Yellow
    }
    
    Write-Host "`nPress Ctrl+C to exit. Refreshing every 2 seconds..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}
