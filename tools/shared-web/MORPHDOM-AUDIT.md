# morphdom 2.7.8 vendoring audit

Audited and vendored on 2026-08-02 from the npm registry tarball:

- package: `morphdom@2.7.8`
- tarball: <https://registry.npmjs.org/morphdom/-/morphdom-2.7.8.tgz>
- registry integrity: `sha512-D/fR4xgGUyVRbdMGU6Nejea1RFzYxYtyurG4Fbv2Fi/daKlWKuXGLOdXtl+3eIwL110cI2hz1ZojGICjjFLgTg==`
- tarball SHA-256: `06bfcd3edc6dcb0fcaa4e6f2aab28656830fd29816bfc96553c6d221bfab4bf3`
- `package/dist/morphdom-esm.js` SHA-256: `b5ecceffde9493a3e5f6d1ca80277f580a1146ca3b3e0091cb3c398d6b2754b3`
- `package/index.d.ts` SHA-256: `32b3c810a8bde40defbaade469eaaae7fe79aedfe07a876a844deeaa05005765`
- `package/LICENSE` SHA-256: `dc18a39627c8f2e5391255635bd1d6bbb02e91ba4a9bd3e13e53347b8c25e61a`

The vendored JavaScript differs from the upstream artifact only by its provenance header. The declaration and MIT license are byte-identical.

## Audit result

The package has no runtime or peer dependencies. The implementation contains no network, storage, dynamic-code evaluation, prototype-chain writes, or global mutation beyond a module-local cached `Range`. An OSV package query performed during the design audit returned no advisories for morphdom.

The main risks belong to usage rather than supply chain:

- morphdom is not a sanitizer; renderers remain responsible for escaping content and synthesized attributes;
- duplicate `id` or `data-state-key` values can silently corrupt keyed reconciliation, so shared commits assert uniqueness;
- the full source tree is indexed for each morph and recursive walks make deeply nested or very large content a regression-test concern;
- disclosure, focus, selection, and scroll continuity require browser evidence rather than assumptions.

Every version bump must repeat the provenance diff, hashes, license review, and OSV query and update this file.
