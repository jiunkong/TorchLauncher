`1.21.1.json` is Mojang's published 1.21.1 client metadata, fetched 2026-10-21
from https://piston-meta.mojang.com/v1/packages/1757c8b1fbfc6b638504e1f6cceb05893f7389d5/1.21.1.json
(upstream SHA-1 `1757c8b1fbfc6b638504e1f6cceb05893f7389d5`; fixture formatting
is normalized by Biome). It exercises real modern
arguments, OS rules and native JAR layouts without downloading game binaries.

The TypeScript fixture builder uses synthetic bytes and HTTPS URLs. No account,
token, Java or Minecraft binary is included in this directory.

`game04-linux-x64-receipt.json` records the account-free GAME-04 cold install and
managed Java `-version` run on Linux x64. `game04-linux-x64-cache-receipt.json`
records a repeat against the installed files. Payload byte counts exclude headers
and TLS; the repeat's disk count includes the prior receipt in the temporary root.
No credentials, original argv, or downloaded game/Java binaries are committed.
