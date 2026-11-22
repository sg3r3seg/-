'use strict';
const { execFile } = require('node:child_process');

// Windows system voices (SAPI via System.Speech). Renders speech to WAV so the
// renderer can play it on the selected output device. Text is passed through
// stdin as JSON — never interpolated into the command line.
const PS_LIST = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $v=$_.VoiceInfo; [pscustomobject]@{ name=$v.Name; culture=$v.Culture.Name; gender=$v.Gender.ToString() } } | ConvertTo-Json -Compress`;
const PS_SYNTH = `$ErrorActionPreference='Stop';
$in = [Console]::OpenStandardInput(); $buf = New-Object System.IO.MemoryStream; $in.CopyTo($buf);
$req = [Text.Encoding]::UTF8.GetString($buf.ToArray()) | ConvertFrom-Json; Add-Type -AssemblyName System.Speech;
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
if ($req.voice) { try { $s.SelectVoice($req.voice) } catch {} }
$s.Rate = [int]$req.rate; $s.Volume = [int]$req.volume;
$ms = New-Object System.IO.MemoryStream; $s.SetOutputToWaveStream($ms);
$p = New-Object System.Speech.Synthesis.PromptBuilder; $p.Culture = $s.Voice.Culture;
try { $p.AppendSsmlMarkup('<prosody pitch="' + $req.pitch + '">' + [System.Security.SecurityElement]::Escape($req.text) + '</prosody>') } catch { $p = New-Object System.Speech.Synthesis.PromptBuilder; $p.AppendText($req.text) }
$s.Speak($p); $s.Dispose(); [Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))`;

const supported = () => process.platform === 'win32';
function run(script, input, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
    if (input !== undefined) { child.stdin.write(input); }
    child.stdin.end();
  });
}
async function voices() {
  if (!supported()) return [];
  const out = await run(PS_LIST);
  const j = JSON.parse(out || '[]');
  return Array.isArray(j) ? j : [j];
}
async function synthesize({ text, voice, rate = 1, pitch = 1, volume = 1 }) {
  if (!supported()) throw Object.assign(new Error('System voices are available on Windows'), { code: 'UNSUPPORTED' });
  const pct = Math.round((pitch - 1) * 50);
  const req = {
    text: String(text).slice(0, 1000), voice: String(voice || ''),
    rate: Math.max(-10, Math.min(10, Math.round((rate - 1) * 10))),
    volume: Math.max(0, Math.min(100, Math.round(volume * 100))),
    pitch: `${pct >= 0 ? '+' : ''}${pct}%`,
  };
  const b64 = await run(PS_SYNTH, JSON.stringify(req));
  return Buffer.from(b64.trim(), 'base64');
}
module.exports = { supported, voices, synthesize };
