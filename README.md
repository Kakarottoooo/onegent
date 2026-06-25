# Onegent

This project has moved into AgentCert as `packages/onegent-runtime`.

New home:

https://github.com/Kakarottoooo/agentcert

## Current Status

Onegent is no longer maintained as a standalone product repository. The Action
Gateway / runtime assurance work now lives inside AgentCert, where it is part of
the full agent assurance lifecycle:

- pre-release MCP/tool evaluation;
- pre-release browser-agent robustness testing;
- post-release action policy, approval, verification, and audit.

The original Onegent repository is kept as historical reference for earlier
travel, booking, browser automation, and Action Gateway experiments.

## Where To Continue Development

Use AgentCert for new work:

```text
https://github.com/Kakarottoooo/agentcert
```

The migrated runtime package is:

```text
packages/onegent-runtime
```

It contains the local Action Gateway MVP for capturing proposed agent actions,
assessing risk, evaluating policy, requiring human approval, mock-executing
approved actions, verifying expected state, and exporting audit packets.

## Safety Note

The maintained AgentCert runtime demo uses local mock systems only. It does not
perform real payments, send real emails, scrape vendor portals, store real
credentials, or modify production systems.
