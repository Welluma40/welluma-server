# Welluma Canadian Azure deployment checklist

## Confirmed in source

- Mobile visits are captured as real audio rather than Android live speech-recognition fragments.
- Audio is uploaded only after authentication, held in server memory, sent to Azure Speech in Canada, and discarded after the request.
- Summaries use the regional `welluma-summary-gpt41mini` Azure OpenAI deployment in Canada East.
- Visit-specific summary resources, general message sharing, provider email, and SRFax routes remain intact.
- The app no longer calls an AI vendor directly for local-resource searches.
- Account deletion remains authenticated and removes the signed-in user's Supabase Auth account.

## Azure settings required before testing

1. Deploy `welluma-server` to the Canadian App Service.
2. Configure every variable listed in `welluma-server/.env.example` under App Service **Environment variables**.
3. Keep secrets in Key Vault and use App Service Key Vault references.
4. Enable the App Service system-assigned managed identity.
5. Retain these least-privilege assignments:
   - `Cognitive Services Speech User` on `welluma-speech-dev-cc`.
   - `Cognitive Services OpenAI User` on `aoai-welluma-dev-ce01`.
   - `Key Vault Secrets User` on `kv-welluma-dev-cc01`.
6. Verify `/health`, then test `/transcribe-audio` and `/analyze` using synthetic data only.
7. Put the Azure API URL in the mobile `.env`, run the web build, then run `npx cap sync` before opening Xcode or Android Studio.

## Release gates

- Test a 30–60 minute visit on at least two physical Android devices, including silence, an incoming call, screen rotation, and recovery from poor connectivity.
- Test iOS on a physical iPhone and confirm the recording survives the expected foreground workflow.
- Confirm email, fax, native message sharing, saved history, deletion, and visit-specific resource links.
- Complete vendor agreements, privacy/security assessment, retention/deletion documentation, incident response, access review, logging redaction, and legal review before real patient data.
- Update Apple App Privacy and Google Play Data Safety disclosures to match the final data flow.

This technical configuration supports Canadian data-residency controls, but it does not by itself certify PHIPA or HIPAA compliance.
