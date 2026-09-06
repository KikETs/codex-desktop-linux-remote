# Supporting a new official build

The build script refuses unknown official ASAR hashes. This is deliberate: bundle
names, variable names, APIs and native key contracts change between releases.

1. Inspect the installed package version, original ASAR hash and native resources.
2. Re-audit the key provider interface, enrollment/signing contract and fallback policy.
3. Identify the controller display conditions and the post-auth return link. Do not
   modify OAuth state/PKCE validation, account authorization, backend gate values,
   challenge validation or sandbox/integrity enforcement.
4. Add the reviewed file names and exact replacement pairs in `scripts/compat.py`.
   **Changing only the accepted hash is not a compatibility review.**
5. Run `python3 one-shot.py`. Every original packed file must be identical after
   reversing the explicitly enumerated changes. Run the actual wrapper signature
   tests against the new bundle, then inspect the generated package transaction.
6. Separately verify real TPM reload after reboot, Korean composition, app grouping,
   enrollment, host reconnect and task execution. Simulator tests are insufficient.

Do not commit official packages, extracted bundles, keys, account/cache data or logs.
The Git repository contains only this local adapter and its tests/build scripts.
