'use strict';
// electron-builder afterPack hook: embeds the LiveX icon and version
// information into LiveX.exe using a pure-JS PE resource editor, so Windows
// installers can be built on Linux/macOS CI without Wine.
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename, info } = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis.length ? vis[0] : ResEdit.Resource.VersionInfo.createEmpty();
  const [ma, mi, pa] = version.split('.').map((x) => parseInt(x, 10) || 0);
  vi.setFileVersion(ma, mi, pa, 0, 1033);
  vi.setProductVersion(ma, mi, pa, 0, 1033);
  const strings = {
    ProductName: 'LiveX', FileDescription: 'LiveX — ONE PLATFORM. EVERY CREATOR.', CompanyName: 'LiveX',
    LegalCopyright: `© ${new Date().getFullYear()} LiveX`, OriginalFilename: `${productFilename}.exe`, InternalName: 'LiveX',
    FileVersion: version, ProductVersion: version,
  };
  for (const lng of vi.getAllLanguagesForStringValues()) vi.setStringValues(lng, strings);
  if (!vi.getAllLanguagesForStringValues().length) vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • LiveX: embedded icon + version ${version} into ${path.basename(exePath)}${info ? '' : ''}`);
};
