#!/usr/bin/env python3
"""Stage a self-contained app; rewrite every non-system Mach-O dependency."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dist/Lyrica.app"
CONTENTS = APP / "Contents"
RESOURCES = CONTENTS / "Resources"
LIB = RESOURCES / "lib"
copied = {}


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def portable_binary(source, destination):
    source = source.resolve()
    if source in copied:
        return copied[source]
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["/bin/cp", "-c", str(source), str(destination)], check=True)
    destination.chmod(0o755)
    copied[source] = destination
    rpaths = re.findall(r"cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.*?) \(offset", run("otool", "-l", str(source)))
    for line in run("otool", "-L", str(source)).splitlines()[1:]:
        dependency = line.strip().split(" (", 1)[0]
        if dependency.startswith(("/System/", "/usr/lib/")):
            continue
        resolved = dependency.replace("@loader_path", str(source.parent))
        if resolved.startswith("@rpath/"):
            candidates = [Path(p.replace("@loader_path", str(source.parent))) / resolved[7:] for p in rpaths]
            resolved = str(next((p for p in candidates if p.exists()), Path("/nonexistent")))
        dependency_path = Path(resolved).resolve()
        if dependency_path == source:
            continue  # dylib's own install name
        if not dependency_path.is_file():
            raise RuntimeError(f"Unresolved dependency: {source}: {dependency}")
        name = hashlib.sha256(str(dependency_path).encode()).hexdigest()[:10] + "-" + dependency_path.name
        target = portable_binary(dependency_path, LIB / name)
        relative = os.path.relpath(target, destination.parent)
        subprocess.run(["install_name_tool", "-change", dependency, "@loader_path/" + relative, str(destination)], check=True, stdout=subprocess.DEVNULL)
    if source.suffix == ".dylib":
        subprocess.run(["install_name_tool", "-id", "@loader_path/" + destination.name, str(destination)], check=True, capture_output=True)
    subprocess.run(["codesign", "--force", "--sign", "-", str(destination)], check=True, capture_output=True)
    return destination


def main():
    if APP.exists():
        shutil.rmtree(APP)
    (CONTENTS / "MacOS").mkdir(parents=True)
    runtime = RESOURCES / "runtime"
    runtime.mkdir(parents=True)
    build_path = Path(run("swift", "build", "--package-path", str(ROOT / "macos"), "-c", "release", "--show-bin-path"))
    shutil.copy2(build_path / "Lyrica", CONTENTS / "MacOS/Lyrica")
    for name in ["src", "public", "node_modules", ".next"]:
        # APFS clones avoid duplicating hundreds of MB while staging dependencies.
        subprocess.run(["/bin/cp", "-cR", str(ROOT / name), str(runtime / name)], check=True)
    for generated in ["node_modules/.cache", "node_modules/.remotion", ".next/cache", ".next/dev"]:
        shutil.rmtree(runtime / generated, ignore_errors=True)
    # Turbopack emits external-package links relative to its inferred workspace.
    # Rebase them into the bundle so neither signing nor startup needs the checkout.
    for link in runtime.rglob("*"):
        if link.is_symlink():
            original = ROOT / link.relative_to(runtime)
            target = original.resolve(strict=True)
            bundled_target = runtime / target.relative_to(ROOT)
            link.unlink()
            link.symlink_to(os.path.relpath(bundled_target, link.parent))
    for name in ["package.json", "tsconfig.json"]:
        shutil.copy2(ROOT / name, runtime / name)
    (RESOURCES / "desktop").mkdir()
    for name in ["server.cjs", "launcher.cjs"]:
        shutil.copy2(ROOT / "macos" / name, RESOURCES / "desktop" / name)
    for name in ["node", "ffmpeg", "ffprobe"]:
        executable = shutil.which(name)
        if not executable:
            raise RuntimeError(f"Build prerequisite missing: {name}")
        portable_binary(Path(executable), RESOURCES / "bin" / name)
    browser_info = json.loads(run("node", "-e", "require('@remotion/renderer').ensureBrowser({logLevel:'error'}).then(x=>console.log(JSON.stringify(x)))"))
    browser = Path(browser_info["path"])
    subprocess.run(["/bin/cp", "-cR", str(browser.parent), str(RESOURCES / "browser")], check=True)
    # Audit dependencies so packaging cannot silently depend on the build machine.
    (RESOURCES / "native-dependencies.json").write_text(json.dumps(
        {str(src): str(dest.relative_to(RESOURCES)) for src, dest in copied.items()}, indent=2) + "\n")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    minimum_os = (14, 0)
    for binary in [*copied.values(), CONTENTS / "MacOS/Lyrica", RESOURCES / "browser/chrome-headless-shell"]:
        load_commands = run("otool", "-l", str(binary))
        versions = re.findall(r"\n\s+minos (\d+\.\d+(?:\.\d+)?)", load_commands)
        versions += re.findall(r"cmd LC_VERSION_MIN_MACOSX\n\s+cmdsize \d+\n\s+version (\d+\.\d+(?:\.\d+)?)", load_commands)
        for value in versions:
            minimum_os = max(minimum_os, tuple(int(part) for part in value.split(".")))
    info = {
        "CFBundleExecutable": "Lyrica", "CFBundleIdentifier": "com.livvux.lyrica",
        "CFBundleName": "Lyrica", "CFBundleDisplayName": "Lyrica",
        "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version,
        "CFBundleVersion": "1", "LSMinimumSystemVersion": ".".join(map(str, minimum_os)),
        "LSMultipleInstancesProhibited": True, "NSPrincipalClass": "NSApplication",
        "NSHighResolutionCapable": True,
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    }
    with (CONTENTS / "Info.plist").open("wb") as output:
        plistlib.dump(info, output)
    # Ad-hoc signing supports local use; distribution needs Developer ID + notarization.
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(APP)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(APP)], check=True)
    for name in ["node", "ffmpeg", "ffprobe"]:
        subprocess.run([str(RESOURCES / "bin" / name), "--version" if name == "node" else "-version"], check=True, stdout=subprocess.DEVNULL)
    print(f"Built {APP} (minimum macOS {info['LSMinimumSystemVersion']})")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
