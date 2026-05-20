Set-Location "C:\Users\EQUIPO\Documents\studio"
git add src/types.ts src/app/actions.ts src/components/TransferLogDialog.tsx src/components/TransfersModule.tsx
git commit -m @"
fix(transferencias): mostrar displayName en trazabilidad de TF

Guarda el usuario que ejecuta cada cambio de estado y lo muestra en el
dialogo Dame Detalles (Trazabilidad), con resolucion por usersMap para
registros historicos de recoleccion.
"@
git push origin main 2>&1 | Out-File -FilePath "C:\Users\EQUIPO\Documents\studio\git-push-log.txt" -Encoding utf8
Get-Content "C:\Users\EQUIPO\Documents\studio\git-push-log.txt"
