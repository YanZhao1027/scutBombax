# SideStore iOS build

This branch generates an **unsigned IPA** through GitHub Actions. SideStore can sign it with your Apple ID on the device. No developer-operated relay, no PWA bridge, no third-party dependencies. It is a limited DXC prototype, not a public release.

1. Open the `iOS SideStore IPA` GitHub Actions run for branch `feat/ios-sidestore`.
2. Download artifact `HuaGongMuMian-SideStore-unsigned-IPA` and unpack the zip to obtain `HuaGongMuMian-SideStore-unsigned.ipa`.
3. Send the IPA to your iPhone SE 2 with AirDrop or Files, open SideStore > My Apps > +, and choose the IPA.
4. Follow SideStore's on-device signing process; keep its VPN/tunnel or local pairing prerequisites as SideStore instructs. A free Apple ID generally requires refreshing the signature roughly every seven days.
5. On campus Wi-Fi or school SSLVPN, open the app, obtain a captcha and select the correct login namespace (`学工号` or `一卡通账号`), then query DXC electric/water balances.

**Privacy:** user passwords are not stored; tokens and session cookies exist in an ephemeral URLSession in RAM, and requests go directly to the school's HTTPS hosts. Balance history is stored in local UserDefaults with room name. Logout clears live session; Clear History deletes saved balances. SideStore's own signing and pairing process is separate from the app's school login.

**Limitations:** DXC only. GZIC not implemented. No local scheduled notifications, trend chart, background fetch, recharge, or export. SSO and login are ported from Android's verified protocol but **have not yet been verified on an iPhone**. Password retries are never automated; if school rejects login, stop and inspect rather than guessing multiple passwords.

## SideStore Chinese-name compatibility (2026-10-10)

SideStore issue [#1489](https://github.com/SideStore/SideStore/issues/1489) documents Apple's developer-registration error when SideStore passes a Chinese display name as `appIdName`. The v0.1.1 IPA uses ASCII `CFBundleDisplayName=HuaGongMuMian` while keeping the Chinese in-app UI text. `CFBundleIdentifier=xyz.huagongmumian.probe` stays unchanged. Always download the artifact from the latest successful build; older v0.1.0 artifacts cannot sign with affected SideStore versions.
