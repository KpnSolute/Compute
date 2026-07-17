KpnCompute CLI inventory
Updated: 2026-07-17

These entries use commands resolved from the current Windows user PATH. No binaries
are copied into this directory.

codex
  Path: C:\Users\ogdev\AppData\Roaming\npm\codex.ps1
  Version: codex-cli 0.144.5
  Source: npm package @openai/codex
  Auth: OpenAI account/login required for use.

claude
  Path: C:\Users\ogdev\AppData\Roaming\npm\claude.ps1
  Version: 2.1.207 (Claude Code)
  Source: npm package @anthropic-ai/claude-code
  Auth: Anthropic account/login required for use.

opencode
  Path: C:\Users\ogdev\AppData\Roaming\npm\opencode.ps1
  Version: 1.18.3
  Source: npm package opencode-ai
  Auth: Provider credentials are required unless using a configured free provider/model.

agy
  Path: C:\Users\ogdev\AppData\Local\agy\bin\agy.EXE
  Version: 1.1.3
  Source: Installed Antigravity CLI
  Auth: Google/Antigravity account or configured credentials required.

mimo
  Path: C:\Users\ogdev\AppData\Roaming\npm\mimo.ps1
  Version: 0.1.6
  Source: npm package @mimo-ai/cli
  Auth: MiMo account/API credentials required for model access.
  Project workaround: cli\mimo.cmd sets MIMOCODE_DISABLE_GIT=1 because the published
  Windows binary fails when it tries to recreate an existing .git\info directory.
  This disables MiMo's automatic Git discovery; Git commands remain available to the agent shell.

gemini
  Path: C:\Users\ogdev\AppData\Roaming\npm\gemini.ps1
  Version: 0.51.0
  Source: npm package @google/gemini-cli
  Auth: Google account/API credentials required for model access.

Verification command:
  Get-Command mimo,gemini,opencode,codex,claude,agy
  mimo --version; gemini --version; opencode --version
  codex --version; claude --version; agy --version
