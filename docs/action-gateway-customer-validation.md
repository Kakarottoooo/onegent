# Action Gateway Customer Validation Script

Goal: find whether teams have agents or automations that can complete work but
cannot be trusted to perform high-risk actions without approval, verification,
and audit.

Use these questions in founder-led calls:

1. Do you have agents or automations that can complete a workflow but cannot be
   trusted to click Submit, Pay, Send, or Update?
2. What real-world action are you afraid to let the agent perform?
3. What happens if that action is wrong?
4. Who currently reviews or approves that action?
5. What system of record does it touch?
6. Would you use an independent third-party verification and approval layer, or
   would you wait for your model provider or agent framework to include this?
7. How much would this be worth monthly if it unblocked production deployment?
8. What audit evidence would you need before trusting it?
9. Would you pay for a design partner pilot this month?
10. What is the first workflow we could safely test with mock execution?

## Target Early Customers

- Operations teams using AI agents for procurement or inventory.
- Finance teams testing invoice approval agents.
- Customer success or sales teams testing outbound message agents.
- Internal automation teams blocked by approval/audit requirements.
- AI consultancies building agent workflows for clients.

## Evidence To Capture

- Workflow name.
- High-risk action type: SUBMIT, PAY, SEND, or UPDATE.
- Current reviewer.
- System of record.
- Expected approval policy.
- Required audit evidence.
- Consequence of a wrong action.
- Willingness to pay for a design partner pilot.

## Disqualifiers

- They only need generic chatbot observability.
- They want a full ERP integration before testing a mock workflow.
- They are comfortable with agents taking irreversible actions without human
  approval.
- They cannot name a specific workflow or reviewer.
