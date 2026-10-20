# AUTH-02 Minecraft rejection diagnostics

## Windows observation

The user reported that the Microsoft browser page completed, then the live smoke command printed
`{"ok":false,"code":"http_failed","stage":"minecraft","status":403}`. The user also
confirmed that this Microsoft account owns Minecraft. No client ID, account identifier, callback URL,
credential, or token is recorded here.

The request sequence reaches the Minecraft token step only after Microsoft OAuth, Xbox user-token,
and XSTS calls return successfully; this ordering is inferred from the implementation and reported
stage. The Minecraft request is the `launcher/login` operation with an XSTS token and the PC launcher
platform marker. The current PrismLauncher `LauncherLoginStep.cpp` implementation uses the same
operation and request fields. That makes an obvious endpoint/body mismatch less likely, but does not
prove the response cause. The returned HTTP status alone cannot distinguish an app-registration
policy rejection from another service-side rejection. Ownership and profile checks are later steps
and were not reached.

The core writes the OAuth refresh session before making Xbox/XSTS/Minecraft service calls. Since this
run reached the Minecraft stage, storage write succeeded for this attempt. A successful `logout`
cleanup result has not been reported. Earlier Windows `probe` and `storage-cycle` JSON results were
also not reported, so this handoff does not claim those checks passed.

## Diagnostic behavior

At the Minecraft stage only, an HTTP 403 is reported as `app_registration_rejected` when its bounded
JSON response has an `errorMessage` exactly matching one of these known forms (case-insensitive,
trimmed, with an optional final period):

- `Invalid app registration`
- The same phrase followed by the known AppRegInfo reference and “for more information”.

If an `error` field is present, it must be `ForbiddenOperationException`; the field may be absent.
Other messages, additional prefix/suffix text, other error kinds, other HTTP statuses/stages,
non-JSON responses, and over-limit responses remain generic failures. The remote message and body
are never included in the error object or smoke output. This classification identifies only an
explicit service message; it does not claim a specific approval process or prove the reason for any
other 403.

The relevant request shape was compared with the current PrismLauncher implementation source at
`launcher/minecraft/auth/steps/LauncherLoginStep.cpp`. Similar recent developer reports on Microsoft
Q&A mention this explicit error, but the reports and replies do not establish an authoritative,
current application-approval procedure.

## Validation

Focused tests cover the recognized message forms, omitted and expected error kind, wrong error kind,
prefix/suffix spoofing, other response stages/statuses, non-JSON responses, and redaction. Validation
on this branch: all authentication tests **148/148 passed**; core, launcher Node, and launcher web
TypeScript checks passed; Biome check/fix on both changed TypeScript files produced no further edits.
The smoke harness was not run because the change only maps an already-redacted error code; no live
authentication was repeated.
