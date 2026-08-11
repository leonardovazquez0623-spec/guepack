$ErrorActionPreference = 'Stop'
$service = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
$headers = @{ apikey = $service; Authorization = "Bearer $service" }
$payload = @{ email='b21-atomic@example.test'; password='S3gura!12345'; email_confirm=$true; user_metadata=@{tenant_id='1'} } | ConvertTo-Json -Compress
try {
  $result = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:54321/auth/v1/admin/users' -Headers $headers -ContentType 'application/json' -Body $payload -UseBasicParsing
  "atomic_signup=$($result.StatusCode):unexpected-success"
} catch {
  "atomic_signup=$([int]$_.Exception.Response.StatusCode):expected-failure"
}
