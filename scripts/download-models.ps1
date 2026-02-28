# Downloads ML models required by PluckIt.Processor into the models/ folder.
# Run this before `func azure functionapp publish` or `func start`.
# The models/ folder is gitignored (files exceed GitHub's 100 MB limit).

$modelsDir = "$PSScriptRoot\..\PluckIt.Processor\models"
New-Item -ItemType Directory -Force $modelsDir | Out-Null

$models = @(
  @{
    Name = "u2net.onnx"
    Url  = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
  }
)

foreach ($model in $models) {
  $dest = Join-Path $modelsDir $model.Name
  if (Test-Path $dest) {
    Write-Host "  [skip] $($model.Name) already exists"
    continue
  }
  Write-Host "  [download] $($model.Name) ..."
  Invoke-WebRequest -Uri $model.Url -OutFile $dest -UseBasicParsing
  $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
  Write-Host "  [ok] $($model.Name) ($mb MB)"
}

Write-Host "Models ready in $modelsDir"
