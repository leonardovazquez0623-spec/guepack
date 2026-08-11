$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:54321'
$anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
$service = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

function Call-Api($method, $uri, $headers, $body) {
  try {
    $r = Invoke-WebRequest -Method $method -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing
    return @{ ok = $true; code = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $response = $_.Exception.Response
    $reader = [IO.StreamReader]::new($response.GetResponseStream())
    return @{ ok = $false; code = [int]$response.StatusCode; body = $reader.ReadToEnd() }
  }
}

function Create-User($email, $metadata) {
  $h = @{ apikey = $service; Authorization = "Bearer $service" }
  return Call-Api 'Post' "$api/auth/v1/admin/users" $h @{ email=$email; password='S3gura!12345'; email_confirm=$true; user_metadata=$metadata }
}

$valid = Create-User 'b21-valid@example.test' @{ tenant_id='1' }
$invalid = Create-User 'b21-invalid@example.test' @{ tenant_id='999' }
$nullTenant = Create-User 'b21-null@example.test' @{}
$empresa = Create-User 'b21-empresa@example.test' @{ empresa_codigo='ACME' }
$mismatch = Create-User 'b21-mismatch@example.test' @{ tenant_id='2'; empresa_codigo='ACME' }

$loginHeaders = @{ apikey=$anon }
$login = Call-Api 'Post' "$api/auth/v1/token?grant_type=password" $loginHeaders @{ email='b21-null@example.test'; password='S3gura!12345' }
$accessToken = ($login.body | ConvertFrom-Json).access_token
$rpcHeaders = @{ apikey=$anon; Authorization="Bearer $accessToken"; Origin='https://www.guepack.com' }
$rpcGood = Call-Api 'Post' "$api/rest/v1/rpc/auto_asignar_rol_cliente" $rpcHeaders @{ p_tenant_id=1 }
$rpcIdempotent = Call-Api 'Post' "$api/rest/v1/rpc/auto_asignar_rol_cliente" $rpcHeaders @{ p_tenant_id=1 }
$rpcWrong = Call-Api 'Post' "$api/rest/v1/rpc/auto_asignar_rol_cliente" $rpcHeaders @{ p_tenant_id=2 }
$rpcUnknownOrigin = Call-Api 'Post' "$api/rest/v1/rpc/auto_asignar_rol_cliente" (@{ apikey=$anon; Authorization="Bearer $accessToken"; Origin='https://attacker.example' }) @{ p_tenant_id=1 }

[pscustomobject]@{
  valid_signup = "$($valid.code):$($valid.ok)"
  invalid_tenant = "$($invalid.code):$($invalid.ok):$($invalid.body)"
  null_tenant_signup = "$($nullTenant.code):$($nullTenant.ok)"
  empresa_signup = "$($empresa.code):$($empresa.ok)"
  mismatch_empresa = "$($mismatch.code):$($mismatch.ok):$($mismatch.body)"
  login = "$($login.code):$($login.ok)"
  rpc_good = "$($rpcGood.code):$($rpcGood.ok):$($rpcGood.body)"
  rpc_idempotent = "$($rpcIdempotent.code):$($rpcIdempotent.ok):$($rpcIdempotent.body)"
  rpc_wrong = "$($rpcWrong.code):$($rpcWrong.ok):$($rpcWrong.body)"
  rpc_unknown_origin = "$($rpcUnknownOrigin.code):$($rpcUnknownOrigin.ok):$($rpcUnknownOrigin.body)"
} | Format-List
