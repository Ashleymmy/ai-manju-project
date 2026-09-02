param(
    [string]$BaseUrl = "http://localhost:3101",
    [string]$Username = "admin",
    [string]$Password = "admin",
    [ValidateSet("any", "memory", "postgres")]
    [string]$ExpectStorage = "any",
    [switch]$SkipDelete
)

$ErrorActionPreference = "Stop"
$Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Invoke-ApiJson {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )

    $uri = "$BaseUrl$Path"
    $requestId = "smoke-$([guid]::NewGuid().ToString('N'))"
    $headers = @{
        "Content-Type" = "application/json"
        "X-Request-Id" = $requestId
    }

    try {
        if ($null -eq $Body) {
            $result = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -WebSession $Session
            $result | Add-Member -NotePropertyName "_request_id" -NotePropertyValue $requestId -Force
            return $result
        }

        $result = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20) -WebSession $Session
        $result | Add-Member -NotePropertyName "_request_id" -NotePropertyValue $requestId -Force
        return $result
    } catch {
        Write-Host "Request failed: $Method $uri"
        if ($_.ErrorDetails.Message) {
            Write-Host "Response body: $($_.ErrorDetails.Message)"
        }
        throw
    }
}

Write-Host "1. Health check"
$health = Invoke-ApiJson -Method GET -Path "/health"
if (-not $health.success) {
    throw "Health check failed"
}
if ($ExpectStorage -ne "any" -and $health.data.storage -ne $ExpectStorage) {
    throw "Expected storage '$ExpectStorage', got '$($health.data.storage)' with db '$($health.data.db)'"
}
Write-Host "   storage=$($health.data.storage) db=$($health.data.db) request_id=$($health._request_id)"

Write-Host "2. Login"
$login = Invoke-ApiJson -Method POST -Path "/api/auth/login" -Body @{
    username = $Username
    password = $Password
}
if (-not $login.success) {
    throw "Login failed"
}
Write-Host "   user=$($login.data.username) role=$($login.data.role) request_id=$($login._request_id)"

Write-Host "3. Create Project"
$project = Invoke-ApiJson -Method POST -Path "/api/projects" -Body @{
    title = "Smoke Project"
    owner_id = "ignored-by-beta-backend"
    data = @{
        id = "local-smoke"
        title = "Smoke Project"
        nodes = @()
        connections = @()
    }
}
$projectId = $project.data.id
Write-Host "   project_id=$projectId request_id=$($project._request_id)"

Write-Host "4. Save Snapshot"
$snapshot = Invoke-ApiJson -Method PUT -Path "/api/projects/$projectId/snapshot" -Body @{
    data = @{
        id = "local-smoke"
        title = "Smoke Project"
        nodes = @(@{ id = "node-1"; type = "text"; title = "Opening"; position = @{ x = 10; y = 20 }; width = 320; height = 180 })
        connections = @()
        chatSessions = @()
        activeChatId = $null
        backgroundMode = "lines"
        showImageInfo = $false
        viewport = @{ x = 0; y = 0; k = 1 }
    }
}
if ($snapshot.data.version -lt 1) {
    throw "Snapshot version was not incremented"
}
Write-Host "   version=$($snapshot.data.version) request_id=$($snapshot._request_id)"

Write-Host "5. Read Snapshot"
$loaded = Invoke-ApiJson -Method GET -Path "/api/projects/$projectId/snapshot"
if ($loaded.data.version -ne $snapshot.data.version) {
    throw "Loaded snapshot version mismatch"
}
Write-Host "   version=$($loaded.data.version) nodes=$($loaded.data.data.nodes.Count) request_id=$($loaded._request_id)"

Write-Host "6. Restart check"
Write-Host "   To verify persistence, restart the API service and run:"
Write-Host "   Login first, then Invoke-RestMethod $BaseUrl/api/projects/$projectId/snapshot with the same WebRequestSession"

if (-not $SkipDelete) {
    Write-Host "7. Delete Project"
    $deleted = Invoke-ApiJson -Method DELETE -Path "/api/projects/$projectId"
    if (-not $deleted.success) {
        throw "Delete failed"
    }
    Write-Host "   deleted=$projectId request_id=$($deleted._request_id)"
} else {
    Write-Host "7. Delete Project skipped"
}

Write-Host "Smoke completed"
