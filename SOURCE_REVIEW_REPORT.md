# Welluma Azure migration source review

Date: August 19, 2026

## Outcome

The supplied mobile and server sources were reviewed and an Azure-ready source package was prepared. The Android recording failure was traced to use of a live speech-recognition session as if it were a durable recorder. That API can stop without the interface reliably reflecting the change, and no audio file remained for recovery. The prepared mobile source now records real audio with `MediaRecorder`, uploads it through an authenticated request, and waits for Canadian Azure Speech transcription before enabling summary generation.

## Implemented

- Replaced mobile live speech recognition with chunked audio capture for both Capacitor platforms.
- Added authenticated `POST /transcribe-audio` with an in-memory upload and Azure Speech processing.
- Routed summaries and visit-specific resource searches through the regional Azure OpenAI deployment.
- Removed direct Anthropic requests, Anthropic consent language, and obsolete speech-recognition native declarations.
- Retained provider email, SRFax, native message/share, saved history, account deletion, and visit-specific resource links.
- Added managed-identity authentication for Azure Speech and Azure OpenAI; API-key fallback is disabled by default.
- Added a Canadian-region startup guard, restricted CORS allowlist, body/upload limits, and `/health` endpoint.
- Aligned Android with target/compile SDK 35 and iOS with a 16.0 minimum deployment target.

## Verification performed

- Server JavaScript syntax check: passed.
- Mobile production web build: passed with pre-existing unused-code warnings only.
- Capacitor Android/iOS synchronization: passed.
- Search for obsolete Anthropic and speech-recognition references in the mobile delivery source: passed after cleanup.
- Android Gradle compilation could not run in this isolated environment because the Gradle distribution download was blocked. It remains a required Android Studio/CI check.
- Xcode compilation and CocoaPods installation require macOS/Xcode and remain required checks.

## Required before patient use

1. Deploy the backend source to the Canadian Azure App Service and configure the documented environment variables through Key Vault references.
2. Use the App Service managed identity with only `Cognitive Services Speech User`, `Cognitive Services OpenAI User`, and `Key Vault Secrets User` access at the applicable resources.
3. Build and test with synthetic data on physical Android and iOS devices, including a 30–60 minute visit, silence, interruption, poor connectivity, email, fax, native sharing, history, deletion, and resource links.
4. Upgrade the App Service from the Free development tier before production and configure production monitoring without transcript/audio content in logs.
5. Increment Android `versionCode`/`versionName` and iOS build/version values for each store upload.
6. Complete Apple privacy labels, Google Data Safety, consent language, vendor agreements, privacy/security assessment, retention/deletion process, access review, incident response, and legal review.

These are technical controls supporting PHIPA/HIPAA readiness. They do not constitute legal certification or, by themselves, establish compliance.
