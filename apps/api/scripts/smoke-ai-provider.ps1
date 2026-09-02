param(
    [string]$BaseUrl = "http://localhost:3101",
    [string]$AdminUsername = "admin",
    [string]$AdminPassword = "admin",
    [string]$MemberUsername = "",
    [string]$MemberPassword = "",
    [string]$ProviderBaseUrl = "http://localhost:11434/v1",
    [ValidateSet("local_openai", "openai_compatible")]
    [string]$Mode = "local_openai",
    [ValidateSet("none", "bearer")]
    [string]$AuthType = "none",
    [string]$ApiKey = "",
    [string]$TextModel = "llama3.1"
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
        "X-Request-Id" = "smoke-ai-$([guid]::NewGuid().ToString('N'))"
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

Write-Host "1. Admin login"
$adminSession = New-Session
Invoke-ApiJson -Session $adminSession -Method POST -Path "/api/auth/login" -Body @{
    username = $AdminUsername
    password = $AdminPassword
} | Out-Null

Write-Host "2. Save provider config"
$body = @{
    mode = $Mode
    base_url = $ProviderBaseUrl
    auth_type = $AuthType
    text_model = $TextModel
    timeout_ms = 30000
    enabled = $true
}
if ($AuthType -eq "bearer") {
    $body.api_key = $ApiKey
}
$provider = Invoke-ApiJson -Session $adminSession -Method PUT -Path "/api/admin/model-provider" -Body $body
if (-not $provider.data.api_key_set -and $AuthType -eq "bearer") {
    throw "Expected api_key_set=true"
}
Write-Host "   mode=$($provider.data.mode) text_model=$($provider.data.text_model) api_key_set=$($provider.data.api_key_set)"

Write-Host "3. Admin provider test"
$test = Invoke-ApiJson -Session $adminSession -Method POST -Path "/api/admin/model-provider/test"
if (-not $test.data.ok) {
    throw "Provider test did not return ok"
}
if (-not $test.data.models -or $test.data.models.Count -lt 1) {
    throw "Provider test returned no models"
}
if ($test.data.models[0] -isnot [string]) {
    throw "Provider test models must be string[]"
}
if (-not $test.data.models_ok -or -not $test.data.text_ok) {
    throw "Provider test expected models_ok=true and text_ok=true"
}
Write-Host "   models=$($test.data.models -join ', ') model=$($test.data.model)"

if ($MemberUsername -eq "" -or $MemberPassword -eq "") {
    Write-Host "4. Create temporary member"
    $suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
    $MemberUsername = "smoke_ai_member_$suffix"
    $MemberPassword = "MemberPass-$suffix"
    Invoke-ApiJson -Session $adminSession -Method POST -Path "/api/admin/users" -Body @{
        username = $MemberUsername
        password = $MemberPassword
        display_name = "Smoke AI Member"
        role = "member"
        status = "active"
    } | Out-Null
}

Write-Host "5. Member login"
$memberSession = New-Session
Invoke-ApiJson -Session $memberSession -Method POST -Path "/api/auth/login" -Body @{
    username = $MemberUsername
    password = $MemberPassword
} | Out-Null

Write-Host "6. Member models"
$models = Invoke-ApiJson -Session $memberSession -Method GET -Path "/api/ai/models"
if (-not $models.data.models -or $models.data.models.Count -lt 1) {
    throw "AI models returned no models"
}
if ($models.data.models[0] -isnot [string]) {
    throw "AI models must be string[]"
}
if (-not $models.data.text_models -or $models.data.text_models[0] -isnot [string]) {
    throw "AI text_models must be string[]"
}
if (-not $models.data.default_text_model) {
    throw "AI models missing default_text_model"
}
Write-Host "   models=$($models.data.models -join ', ') default=$($models.data.default_text_model)"

Write-Host "7. Member text"
$text = Invoke-ApiJson -Session $memberSession -Method POST -Path "/api/ai/text" -Body @{
    prompt = "Reply with pong."
}
if (-not $text.data.text) {
    throw "AI text response is empty"
}
Write-Host "   model=$($text.data.model) text=$($text.data.text)"

Write-Host "AI provider smoke completed"
