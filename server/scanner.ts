import yauzl from 'yauzl';

export type ScanResult = { ok: boolean; findings: string[] };
const secretPatterns = [
  /bot\d{6,}:[A-Za-z0-9_-]{20,}/i,
  /-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /AWS_SECRET_ACCESS_KEY\s*=\s*[^\s]+/i,
  /DATABASE_URL\s*=\s*postgresql:\/\/[^\s]+/i,
  /SESSION_COOKIE|PRIVATE_COOKIE|AUTHORIZATION=Bearer/i,
  /sk_live_[A-Za-z0-9]{24,}/i,
  /xox[baprs]-[A-Za-z0-9-]+/i,
];

export function scanTextForSecrets(text: string): ScanResult {
  const findings = secretPatterns.flatMap((re) => re.test(text) ? [`pattern:${re.source.slice(0, 32)}`] : []);
  return { ok: findings.length === 0, findings };
}

export function validateMagicBytes(buffer: Buffer, fileName: string, mime: string): ScanResult {
  const lower = fileName.toLowerCase();
  const isZip = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const isGzip = buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
  const isText = /^[\x09\x0a\x0d\x20-\x7e\u0400-\u04ff]*$/u.test(buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8'));
  if ((lower.endsWith('.zip') || mime.includes('zip')) && !isZip) return { ok: false, findings: ['fake_zip_extension'] };
  if ((lower.endsWith('.gz') || lower.endsWith('.tar.gz') || mime.includes('gzip')) && !isGzip) return { ok: false, findings: ['fake_gzip_extension'] };
  if (lower.endsWith('.txt') && !isText) return { ok: false, findings: ['fake_text_extension'] };
  if (!/\.(zip|txt|md|tar|gz|tar\.gz)$/i.test(lower)) return { ok: false, findings: ['extension_not_allowed'] };
  return { ok: true, findings: [] };
}

export async function scanArchiveBuffer(buffer: Buffer, fileName: string, mime: string, maxEntries = 2000): Promise<ScanResult> {
  const findings: string[] = [];
  const magic = validateMagicBytes(buffer, fileName, mime);
  findings.push(...magic.findings);
  findings.push(...scanTextForSecrets(buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString('utf8')).findings);
  if (!fileName.toLowerCase().endsWith('.zip')) return { ok: findings.length === 0, findings };

  await new Promise<void>((resolve) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { findings.push('bad_zip'); return resolve(); }
      let entries = 0;
      zip.readEntry();
      zip.on('entry', (entry) => {
        entries += 1;
        const name = entry.fileName;
        if (entries > maxEntries) findings.push('too_many_entries');
        if (name.startsWith('/') || name.includes('..') || /^[a-zA-Z]:/.test(name)) findings.push(`zip_slip:${name.slice(0, 80)}`);
        if ((entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) findings.push(`symlink:${name.slice(0, 80)}`);
        if (/\.env(\.|$)|id_rsa|private[_-]?key|cookies?\.json/i.test(name)) findings.push(`suspicious_file:${name.slice(0, 80)}`);
        zip.readEntry();
      });
      zip.on('end', () => resolve());
      zip.on('error', () => { findings.push('zip_read_error'); resolve(); });
    });
  });
  return { ok: findings.length === 0, findings: [...new Set(findings)] };
}
