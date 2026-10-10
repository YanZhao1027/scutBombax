#!/usr/bin/env python3
"""Generate a deterministic Xcode project without Xcode on the Ubuntu build host.

The produced .xcodeproj is a conventional single-target SwiftUI iOS app,
requires no CocoaPods/SPM/network fetch, and uses automatic Personal Team signing.
"""
from pathlib import Path
import hashlib
import json

base = Path(__file__).resolve().parent / "HuaGongMuMianProbe"
source = base / "HuaGongMuMianProbe"
project = base / "HuaGongMuMianProbe.xcodeproj" / "project.pbxproj"

def guid(value: str) -> str:
    return hashlib.sha1(("huagongmumian-ios-native-probe/" + value).encode()).hexdigest()[:24].upper()

sources = (
    "HuaGongMuMianProbeApp.swift",
    "ContentView.swift",
    "SchoolAPI.swift",
    "ProbeInspector.swift",
    "ProbeNetwork.swift",
    "ProbeViewModel.swift",
)
prj, native, main_group, src_group, products = (
    guid(name) for name in ("project", "nativeTarget", "mainGroup", "srcGroup", "productsGroup")
)
app_ref, assets_ref = guid("appReference"), guid("assetsRef")
src_refs = {n: guid("sourceRef:" + n) for n in sources}
src_builds = {n: guid("sourceBuild:" + n) for n in sources}
assets_build = guid("assetsBuild")
sources_phase, resources_phase, frameworks_phase = (
    guid(n) for n in ("sourcesPhase", "resourcesPhase", "frameworksPhase")
)
prj_config_list, app_config_list = guid("projectConfigList"), guid("appConfigList")
prj_debug, prj_release, app_debug, app_release = (
    guid(n) for n in ("projectDebug", "projectRelease", "appDebug", "appRelease")
)

parts = []
def add(line: str = "") -> None:
    parts.append(line)

add("// !$*UTF8*$!")
add("{")
add("\tarchiveVersion = 1;")
add("\tclasses = {")
add("\t};")
add("\tobjectVersion = 56;")
add("\tobjects = {")
add("\t\t/* Begin PBXBuildFile section */")
for name in sources:
    add(f"\t\t{src_builds[name]} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {src_refs[name]} /* {name} */; }};")
add(f"\t\t{assets_build} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {assets_ref} /* Assets.xcassets */; }};")
add("\t\t/* End PBXBuildFile section */")
add("")
add("\t\t/* Begin PBXFileReference section */")
add(f"\t\t{app_ref} /* HuaGongMuMianProbe.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = HuaGongMuMianProbe.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
for name in sources:
    add(f"\t\t{src_refs[name]} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = \"<group>\"; }};")
add(f"\t\t{assets_ref} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\"; }};")
add("\t\t/* End PBXFileReference section */")
add("")
add("\t\t/* Begin PBXFrameworksBuildPhase section */")
add(f"\t\t{frameworks_phase} /* Frameworks */ = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};")
add("\t\t/* End PBXFrameworksBuildPhase section */")
add("")
add("\t\t/* Begin PBXGroup section */")
add(f"\t\t{main_group} = {{isa = PBXGroup; children = (")
add(f"\t\t\t{src_group} /* HuaGongMuMianProbe */,")
add(f"\t\t\t{products} /* Products */,")
add("\t\t); sourceTree = \"<group>\"; };")
add(f"\t\t{src_group} /* HuaGongMuMianProbe */ = {{isa = PBXGroup; children = (")
for name in sources:
    add(f"\t\t\t{src_refs[name]} /* {name} */,")
add(f"\t\t\t{assets_ref} /* Assets.xcassets */,")
add("\t\t); path = HuaGongMuMianProbe; sourceTree = \"<group>\"; };")
add(f"\t\t{products} /* Products */ = {{isa = PBXGroup; children = (")
add(f"\t\t\t{app_ref} /* HuaGongMuMianProbe.app */,")
add("\t\t); name = Products; sourceTree = \"<group>\"; };")
add("\t\t/* End PBXGroup section */")
add("")
add("\t\t/* Begin PBXNativeTarget section */")
add(f"\t\t{native} /* HuaGongMuMianProbe */ = {{")
add("\t\t\tisa = PBXNativeTarget;")
add(f"\t\t\tbuildConfigurationList = {app_config_list} /* Build configuration list for PBXNativeTarget \"HuaGongMuMianProbe\" */;")
add("\t\t\tbuildPhases = (")
add(f"\t\t\t\t{sources_phase} /* Sources */,")
add(f"\t\t\t\t{frameworks_phase} /* Frameworks */,")
add(f"\t\t\t\t{resources_phase} /* Resources */,")
add("\t\t\t);")
add("\t\t\tbuildRules = ();")
add("\t\t\tdependencies = ();")
add("\t\t\tname = HuaGongMuMianProbe;")
add("\t\t\tproductName = HuaGongMuMianProbe;")
add(f"\t\t\tproductReference = {app_ref} /* HuaGongMuMianProbe.app */;")
add("\t\t\tproductType = \"com.apple.product-type.application\";")
add("\t\t};")
add("\t\t/* End PBXNativeTarget section */")
add("")
add("\t\t/* Begin PBXProject section */")
add(f"\t\t{prj} /* Project object */ = {{")
add("\t\t\tisa = PBXProject;")
add("\t\t\tattributes = {")
add("\t\t\t\tBuildIndependentTargetsInParallel = 1;")
add("\t\t\t\tLastUpgradeCheck = 1600;")
add("\t\t\t\tTargetAttributes = {")
add(f"\t\t\t\t\t{native} = {{CreatedOnToolsVersion = 16.0; ProvisioningStyle = Automatic; }};")
add("\t\t\t\t};")
add("\t\t\t};")
add(f"\t\t\tbuildConfigurationList = {prj_config_list} /* Build configuration list for PBXProject \"HuaGongMuMianProbe\" */;")
add("\t\t\tcompatibilityVersion = \"Xcode 14.0\";")
add("\t\t\tdevelopmentRegion = zh_CN;")
add("\t\t\thasScannedForEncodings = 0;")
add("\t\t\tknownRegions = (en, Base, \"zh-Hans\");")
add(f"\t\t\tmainGroup = {main_group};")
add(f"\t\t\tproductRefGroup = {products} /* Products */;")
add("\t\t\tprojectDirPath = \"\";")
add("\t\t\tprojectRoot = \"\";")
add("\t\t\ttargets = (")
add(f"\t\t\t\t{native} /* HuaGongMuMianProbe */,")
add("\t\t\t);")
add("\t\t};")
add("\t\t/* End PBXProject section */")
add("")
add("\t\t/* Begin PBXResourcesBuildPhase section */")
add(f"\t\t{resources_phase} /* Resources */ = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (")
add(f"\t\t\t{assets_build} /* Assets.xcassets in Resources */,")
add("\t\t); runOnlyForDeploymentPostprocessing = 0; };")
add("\t\t/* End PBXResourcesBuildPhase section */")
add("")
add("\t\t/* Begin PBXSourcesBuildPhase section */")
add(f"\t\t{sources_phase} /* Sources */ = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (")
for name in sources:
    add(f"\t\t\t{src_builds[name]} /* {name} in Sources */,")
add("\t\t); runOnlyForDeploymentPostprocessing = 0; };")
add("\t\t/* End PBXSourcesBuildPhase section */")
add("")
add("\t\t/* Begin XCBuildConfiguration section */")

def append_configuration(object_id: str, label: str, settings: dict[str, str]) -> None:
    add(f"\t\t{object_id} /* {label} */ = {{")
    add("\t\t\tisa = XCBuildConfiguration;")
    add("\t\t\tbuildSettings = {")
    for name, value in sorted(settings.items()):
        add(f"\t\t\t\t{name} = {value};")
    add("\t\t\t};")
    add(f"\t\t\tname = {label};")
    add("\t\t};")

project_settings = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CODE_SIGN_STYLE": "Automatic",
    "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
    "SDKROOT": "iphoneos",
    "SWIFT_VERSION": "5.0",
}
append_configuration(prj_debug, "Debug", {
    **project_settings,
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": "\"-Onone\"",
})
append_configuration(prj_release, "Release", {
    **project_settings,
    "DEBUG_INFORMATION_FORMAT": "\"dwarf-with-dsym\"",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": "\"-O\"",
})
app_settings = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "2",
    "ENABLE_PREVIEWS": "YES",
    "GENERATE_INFOPLIST_FILE": "YES",
    "INFOPLIST_KEY_CFBundleDisplayName": "\"HuaGongMuMian\"",
    "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES",
    "INFOPLIST_KEY_UILaunchScreen_Generation": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
    "LD_RUNPATH_SEARCH_PATHS": "\"$(inherited) @executable_path/Frameworks\"",
    "MARKETING_VERSION": "0.1.1",
    "PRODUCT_BUNDLE_IDENTIFIER": "xyz.huagongmumian.probe",
    "PRODUCT_NAME": "\"$(TARGET_NAME)\"",
    "SDKROOT": "iphoneos",
    "SUPPORTED_PLATFORMS": "\"iphoneos iphonesimulator\"",
    "SUPPORTS_MACCATALYST": "NO",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": "\"1,2\"",
}
append_configuration(app_debug, "Debug", app_settings)
append_configuration(app_release, "Release", app_settings)
add("\t\t/* End XCBuildConfiguration section */")
add("")
add("\t\t/* Begin XCConfigurationList section */")
add(f"\t\t{prj_config_list} /* Build configuration list for PBXProject \"HuaGongMuMianProbe\" */ = {{isa = XCConfigurationList; buildConfigurations = (")
add(f"\t\t\t{prj_debug} /* Debug */,")
add(f"\t\t\t{prj_release} /* Release */,")
add("\t\t); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };")
add(f"\t\t{app_config_list} /* Build configuration list for PBXNativeTarget \"HuaGongMuMianProbe\" */ = {{isa = XCConfigurationList; buildConfigurations = (")
add(f"\t\t\t{app_debug} /* Debug */,")
add(f"\t\t\t{app_release} /* Release */,")
add("\t\t); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };")
add("\t\t/* End XCConfigurationList section */")
add("\t};")
add(f"\trootObject = {prj} /* Project object */;")
add("}")
project.parent.mkdir(parents=True, exist_ok=True)
project.write_text("\n".join(parts) + "\n", encoding="utf-8")

for name in sources:
    assert (source / name).is_file(), name

app_icon = source / "Assets.xcassets" / "AppIcon.appiconset"
manifest = {
    "images": [{
        "filename": "AppIcon-1024.png",
        "idiom": "universal",
        "platform": "ios",
        "size": "1024x1024"
    }],
    "info": {"author": "xcode", "version": 1}
}
(app_icon / "Contents.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print("Xcode .pbxproj generated:", project)
print("Source count:", len(sources))
