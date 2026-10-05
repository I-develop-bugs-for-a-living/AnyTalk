// electron-builder afterPack hook. When a Windows build runs on a non-Windows
// host without Wine, `signAndEditExecutable` is off and electron-builder skips
// rcedit, so AnyTalk.exe would keep Electron's icon and version info. This sets
// them with the pure-JS resedit package. On Windows hosts it does nothing and
// electron-builder's normal path applies.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ResEdit from "resedit";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Language (en-US) and code page (Unicode) of the version strings. */
const LANG = { lang: 1033, codepage: 1200 };

/**
 * Turn a package.json version into the four numbers a Windows exe needs.
 * @param {string} version Version like 1.2.3 or 1.2.3-beta.1
 * @returns {[number, number, number, number]} Version parts
 */
function toWindowsVersion(version) {
  const [a = 0, b = 0, c = 0] = version
    .split(/[-+]/)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return [a, b, c, 0];
}

/**
 * Set the icon and version info of the packed Windows exe.
 * @param {import("electron-builder").AfterPackContext} context Build context
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32" || process.platform === "win32")
    return;

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const exePath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
  const resources = ResEdit.NtExecutableResource.from(exe);

  // replace every icon group Electron shipped with ours
  const icons = ResEdit.Data.IconFile.from(
    readFileSync(join(root, "build/icon.ico")),
  ).icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw new Error("[afterPack] exe has no icon group");
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icons,
    );
  }
  console.log(`[afterPack] replaced ${groups.length} icon group(s)`);

  // version info
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const [major, minor, patch, build] = toWindowsVersion(pkg.version);
  info.setFileVersion(major, minor, patch, build, LANG.lang);
  info.setProductVersion(major, minor, patch, build, LANG.lang);
  info.setStringValues(LANG, {
    ProductName: pkg.productName,
    FileDescription: pkg.productName,
    InternalName: pkg.productName,
    OriginalFilename: `${pkg.productName}.exe`,
    CompanyName: "AnyTalk",
    LegalCopyright: "AnyTalk",
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  });
  info.outputToResourceEntries(resources.entries);

  resources.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`[afterPack] set icon and version info on ${exePath}`);
}
