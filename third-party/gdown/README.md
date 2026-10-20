# gdown-derived Google Drive link handling

TorchLauncher adapts the small public-link parsing and download-confirmation
steps from [gdown](https://github.com/wkentaro/gdown), licensed under the MIT
license. The upstream source commit is
[`fba3f9aa27b76fabfee0502f21a1988678bfd710`](https://github.com/wkentaro/gdown/commit/fba3f9aa27b76fabfee0502f21a1988678bfd710)
(tag `v6.1.0`). The required license notice is in [LICENSE](LICENSE).

Adapted source areas:

- `gdown/parse_url.py`: file ID extraction from Drive `id` query parameters and
  common `/file/d/<id>/view`-style share paths.
- `gdown/download.py::get_url_from_gdrive_confirmation`: confirmation `href`,
  hidden form fields, embedded `downloadUrl`, and Drive error-page patterns.

The TypeScript implementation is in `packages/core/src/download/google-drive/`.
TorchLauncher adds strict HTTPS Google-host allowlists, bounded redirects and
page reads, and a small in-memory cookie jar scoped to Google-owned hosts. It
does not import or run Python, persist browser cookies, or add Google account
authentication. The adaptation is limited to public single-file links; folder
downloads and Google Docs export behavior are out of scope.
