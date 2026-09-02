# Reproducible Evolution 2.3.7 preview gate

This directory records the small source patch applied to the official
Evolution API 2.3.7 baseline.

UPSTREAM_REPO: evolution-foundation/evolution-api
UPSTREAM_TAG: 2.3.7
UPSTREAM_COMMIT: cd800f2976e1e5b682fbf86a01ee4d85ae61f370
BAILEYS: 7.0.0-rc13
BRIDGE: 0.5.4

The Docker build fetches the exact upstream commit, verifies `git rev-parse
HEAD`, applies `patches/2.3.7-preview-required.patch`, installs the pinned
Baileys dependency set, generates Prisma, and runs the official build. The
patch is intentionally kept small and can be reapplied to a clean checkout of
the same upstream commit.
