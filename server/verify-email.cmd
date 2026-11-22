@echo off
chcp 65001 >nul
title LiveX - verify an email (test server)
if not exist "%~dp0server\node\node.exe" goto :wrongplace
set "EMAIL="
set "INPUT="
echo.
echo  LIVEX - verify an account email on the test server
echo  ===================================================
set /p "INPUT= Email to verify: "
if not "%INPUT%"=="" set "EMAIL=%INPUT%"
"%~dp0server\node\node.exe" --disable-warning=ExperimentalWarning -e "eval(require('fs').readFileSync(process.argv[1],'utf8').split('::LIVEX'+'JS::')[1])" "%~f0" "%EMAIL%"
echo.
pause
exit /b

:wrongplace
echo.
echo  Put this file inside the extracted LiveX-Test-Kit folder
echo  (next to 2-Start-Server.cmd) and run it from there.
echo.
pause
exit /b

::LIVEXJS::
const path = require('path'); const fs = require('fs');
const email = String(process.argv[2] || '').trim().toLowerCase();
const dbFile = path.join(path.dirname(process.argv[1]), 'server', 'data', 'livex.db');
if (!fs.existsSync(dbFile)) {
  console.log('\n  No LiveX database yet. Start the server (2-Start-Server.cmd) and register the account first.');
  process.exit(1);
}
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA busy_timeout = 5000');
const u = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
if (!u) {
  console.log(`\n  No LiveX account for "${email}".`);
  console.log('  Register first (in LiveX: "Create account", or at http://127.0.0.1:8787/register.html), then run this again.');
  process.exit(1);
}
db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(Date.now(), u.id);
db.prepare('INSERT INTO audit_log(user_id, action, detail, ip, created_at) VALUES (?, ?, NULL, NULL, ?)').run(u.id, 'email_verified_by_admin', Date.now());
db.close();
console.log(`\n  DONE - email verified: ${u.email}`);
console.log(`  Name: ${u.first_name} ${u.last_name}   User ID: ${u.public_id}`);
console.log('  You can sign in to LiveX now.');
