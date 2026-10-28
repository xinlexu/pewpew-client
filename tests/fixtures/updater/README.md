Test fixtures for `scripts/pewpew-update-manifest.mjs`.

`fixture-installer.bin` is 2 KB of random bytes, signed with a throwaway key
(`tauri signer generate`) that exists only for these tests. Its private key was
discarded; it is not PewPew's release key.

`fixture-signature.txt` holds only that test signature. Release installers and
their `.sig` artifacts are not source files and must not be committed.
