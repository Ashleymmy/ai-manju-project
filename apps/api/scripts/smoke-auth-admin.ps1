param(
    [string]$BaseUrl = "http://localhost:3101",
    [string]$AdminUsername = "admin",
    [string]$AdminPassword = "admin"
)

$ErrorActionPreference = "Stop"

function New-Session {
    return New-Object Microsoft.PowerShell.Commands.WebRequestSession
}

function Invoke-ApiJson {
    param(
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )

    $uri = "$BaseUrl$Path"
    $headers = @{
        "Content-Type" = "application/json"
        "X-Request-Id" = "smoke-auth-$([guid]::NewGuid().ToString('N'))"
    }

    try {
        if ($null -eq $Body) {
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -WebSession $Session
        }
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20) -WebSession $Session
    } catch {
        Write-Host "Request failed: $Method $uri"
        if ($_.ErrorDetails.Message) {
            Write-Host "Response body: $($_.ErrorDetails.Message)"
        }
        throw
    }
}

function Invoke-ExpectStatus {
    param(
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [string]$Method,
        [string]$Path,
        [int]$Status,
        [object]$Body = $null
    )

    $uri = "$BaseUrl$Path"
    $headers = @{
        "Content-Type" = "application/json"
        "X-Request-Id" = "smoke-auth-$([guid]::NewGuid().ToString('N'))"
    }
    try {
        if ($null -eq $Body) {
            Invoke-WebRequest -Method $Method -Uri $uri -Headers $headers -WebSession $Session | Out-Null
        } else {
            Invoke-WebRequest -Method $Method -Uri $uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20) -WebSession $Session | Out-Null
        }
        throw "Expected HTTP $Status but request succeeded"
    } catch {
        $response = $_.Exception.Response
        if ($null -eq $response) {
            throw
        }
        if ([int]$response.StatusCode -ne $Status) {
            throw "Expected HTTP $Status but got $([int]$response.StatusCode)"
        }
    }
}

Write-Host "1. Anonymous admin request returns 401"
Invoke-ExpectStatus -Session (New-Session) -Method GET -Path "/api/admin/users" -Status 401

Write-Host "2. Admin login"
$adminSession = New-Session
$admin = Invoke-ApiJson -Session $adminSession -Method POST -Path "/api/auth/login" -Body @{
    username = $AdminUsername
    password = $AdminPassword
}
Write-Host "   admin=$($admin.data.username) role=$($admin.data.role)"

Write-Host "3. Create member"
$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$memberUsername = "smoke_member_$suffix"
$memberPassword = "MemberPass-$suffix"
$member = Invoke-ApiJson -Session $adminSession -Method POST -Path "/api/admin/users" -Body @{
    username = $memberUsername
    password = $memberPassword
    display_name = "Smoke Member"
    role = "member"
    status = "active"
}
Write-Host "   member=$($member.data.username) id=$($member.data.id)"

Write-Host "4. Member cannot access admin"
$memberSession = New-Session
Invoke-ApiJson -Session $memberSession -Method POST -Path "/api/auth/login" -Body @{
    username = $memberUsername
    password = $memberPassword
} | Out-Null
Invoke-ExpectStatus -Session $memberSession -Method GET -Path "/api/admin/users" -Status 403

Write-Host "5. Disable member"
Invoke-ApiJson -Session $adminSession -Method PUT -Path "/api/admin/users/$($member.data.id)" -Body @{
    status = "disabled"
} | Out-Null

Write-Host "6. Disabled member login returns 403"
Invoke-ExpectStatus -Session (New-Session) -Method POST -Path "/api/auth/login" -Status 403 -Body @{
    username = $memberUsername
    password = $memberPassword
}

Write-Host "Auth/admin smoke completed"
