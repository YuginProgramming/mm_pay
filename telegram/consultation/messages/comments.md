# Consultation message comments

This file contains editorial notes extracted from old draft-like markers in message sources.
These notes are internal only and should not be sent to users.

## Extracted from `descr-client.json` draft

- The old block `🔘 КНОПКА` was a drafting marker, not user-facing content.
- The line `Записатися на консультацію` was converted into structured JSON CTA (`cta.text`).
- A standalone arrow line (`👉`) was removed as editorial noise.

## Extracted from `descr-master.json` draft

- No explicit draft marker block like `🔘 КНОПКА`, but formatting was normalized into structured `paragraphs`.
- CTA was made explicit in JSON as `cta.text` + `cta.action`.

## Runtime rule

- Bot renders only: `title`, `paragraphs`, `cta`.
- `comments.md` is documentation for editors and developers.
- `cta.action` values (`payment_client`, `payment_master`) map to consultation checkout handlers.
- Payment buttons now create one-time WayForPay checkouts for two products:
  - `consultation_client_one_time`
  - `consultation_master_one_time`
