# Számla AI — Technical Project Overview

*Evidence-based portfolio brief for technical review. Prepared from the supplied `szamlazo-app-main.zip` source snapshot and the referenced project discussion; it is not a deployment or production-readiness certification.*

## Executive summary

Számla AI is a Hungarian-language invoice capture and processing application. The supplied source snapshot shows a TypeScript web application that accepts invoice images, PDFs, URLs, or text prompts; uses Google Gemini to extract or structure invoice data; validates the result; and provides invoice review, export, and a route for issuing invoices through Számlázz.hu. The code also includes account, billing, storage, and settings components.

Its engineering substance is in coordinating an AI extraction step with schema and arithmetic checks, human correction, persistence, credit accounting, and an external invoicing API. The repository snapshot includes backend test suites, but this review did not execute them. No claim is made here that the application is deployed, production-ready, or currently serving users.

## Product and intended users

The UI and code model support a workflow for Hungarian small businesses or professionals who process incoming invoice documents and prepare invoice data for review or issuance. This is an inference from the Hungarian product copy, Hungarian field names and legal text, HUF support, and the Számlázz.hu and NAV-related settings in the source. User interviews or product documentation were not included, so the actual target segment and customer validation remain unverified.

The Hungarian interface appears intentional: the application copy is Hungarian, the data model uses Hungarian invoice terminology, and the visible integrations and legal requirements are oriented to Hungarian invoicing. The supplied files do not show an English UI or an internationalization system. For an English-language technical review, this document provides the English explanation without implying that the product itself is localized into English.

## Feature overview

Features evidenced by source files in the supplied snapshot:

- **Document intake:** upload or drag-and-drop images and PDFs, use a mobile camera input, submit a URL, or enter invoice details as text. Batch image/document processing is limited in code to ten items per request.
- **AI-assisted extraction:** backend service code sends image data or text to Google Gemini. Image extraction requests JSON output; text extraction uses a function-calling schema.
- **Validation and review:** shared Zod schemas define invoice fields and check totals. Invalid extraction results are flagged for review, and invoice records can be edited through an authenticated API route.
- **Invoice management:** authenticated listing with pagination, soft deletion, and an audit-log entry for deletion.
- **Export:** an export route and frontend export code are present. CSV sanitization logic is covered by a security test file.
- **Invoice issuance:** an authenticated route maps validated invoice data to the `szamlazz.js` client and calls Számlázz.hu. The route requires specified buyer details and at least one line item.
- **Accounts and monetization:** auth and billing modules, Stripe dependencies, credit fields, and password-reset configuration are present. Their end-to-end operational behavior was not exercised for this overview.

These are code-level capabilities; their availability in a hosted product has not been verified.

## Architecture and stack

The supplied archive contains three application areas:

- **Frontend:** Astro 7 with TypeScript, Tailwind CSS 4, and DaisyUI 5. UI components are Astro files with browser-side TypeScript modules.
- **Backend:** Node.js and TypeScript using Hono and `@hono/node-server`. Routes cover authentication, billing, settings, invoice CRUD, parsing, partners, export, and Számlázz.hu integration.
- **Shared contracts:** a local `shared` package defines invoice types and Zod validation schemas consumed by frontend and backend.
- **Persistence:** PostgreSQL through Drizzle ORM. The schema includes users, invoice records, payments, and audit logs.
- **Object storage:** S3-compatible storage using the AWS SDK; the example configuration uses MinIO. Uploaded document references can be returned as presigned URLs.
- **External services represented in code/configuration:** Google Gemini, Számlázz.hu, Stripe, and Resend email. Umami analytics is optional and disabled by default in the example frontend configuration.

The backend source includes CORS allowlisting, request-size limits, rate limiters, authentication checks, a URL-validation helper for document URLs, and AES-256-GCM utility code for secrets. These are implementation details visible in the snapshot, not an independent security assessment. The example configuration lists sensitive service credentials; real values must never be included in a public repository.

## Representative engineering challenges and decisions

1. **Treating model output as untrusted structured input.** The shared schema validates extracted fields and cross-checks invoice totals. The review route preserves invalid values while marking them for review, allowing correction rather than silently treating every model response as correct.
2. **Keeping extraction and invoice issuance distinct.** The issuance route parses invoice data again and checks required buyer information and line items before calling the invoicing integration. This creates a deliberate review/validation boundary before an external financial action.
3. **Handling batches and credits.** The parsing route reserves credits with a conditional database update and refunds unsuccessful items after the batch completes. It streams per-item progress using server-sent events. Concurrency, disconnect, and failure behavior still need runtime verification.
4. **Protecting document and export boundaries.** The code includes URL checks, file size/type checks, request limits, CSV formula sanitization, and tests for several security-sensitive cases. Their real-world effectiveness has not been audited in this review.

These observations describe choices in the supplied code, not claims about the developer's individual authorship of each change. The ZIP has no `.git` directory, commit log, PR history, or authorship metadata, so the history and implementation provenance cannot be independently described.

## AI-assisted development workflow

The product code demonstrates application-level AI use through Gemini for invoice extraction and text-to-invoice structuring. The referenced discussion mentions AI coding assistants and an intended AI-assisted engineering evaluation, but it does not document the tools, prompts, review practices, or testing loop used to build this project. Therefore, this overview does not attribute a particular development workflow to the author.

To make this section portfolio-ready, add a short first-person account of which coding assistants you used, what tasks you delegated, how you reviewed generated changes, and one concrete example where you corrected or rejected an AI suggestion. Include only details you can personally verify.

## Testing and quality evidence

The archive contains Vitest configuration and backend suites named `api.test.ts`, `phase2.test.ts`, `phase3.test.ts`, `schema.test.ts`, and `security.test.ts`. Example security tests cover URL/SSRF validation, CSV formula injection, and password-reset origin behavior. Package scripts define backend tests, type checking, and build commands; the frontend defines type-check and build commands.

The presence of tests and scripts does not prove they pass. They were not run for this overview, and no CI run, coverage report, dependency audit, or browser/end-to-end test result was supplied. A Hungarian planning document contains historic validation claims, but those claims are not treated as current verification.

## Current status and known gaps

**Verified status:** a source snapshot with frontend, backend, shared schema, tests, configuration examples, and planning documents was provided. The available ChatGPT project listing did not expose a `szamlazo-app` repository checkout. This deliverable is therefore saved separately from the source tree.

**Unknown:** deployment and uptime; whether real users or customers use the product; current feature completeness; whether integrations have valid credentials or have been exercised against live services; current test/build results; production security and privacy posture; and the developer's personal AI-assisted coding process.

**Known evidence limitation:** the ZIP includes source but not Git metadata. It cannot substantiate commit chronology, contribution history, repository visibility, or a public GitHub URL. Planning documents are design or audit artifacts, not proof that every proposed fix or deployment step was completed.

## Safe-publication checklist

- Review the public repository and archive for `.env` files, real credentials, personal data, sample invoices, private URLs, and customer information. Keep only sanitized examples.
- Confirm that public release of the source, product name, screenshots, and integration details is allowed and that any third-party assets and dependencies are appropriately licensed.
- Inspect the Hungarian privacy notice and terms before presenting them as legally reviewed or operationally current. Do not make compliance claims based only on their presence in the archive.
- Run the documented type checks, builds, and tests in a clean environment; record actual commands, results, and date. Add a CI link or sanitized report if available.
- Add screenshots or a short sanitized demo showing intake, extraction, human review, and export/issuance. Use synthetic invoice data and a test account.
- Verify the public repository URL and that its current default branch corresponds to the snapshot being described. Preserve the original Hungarian commit history; explain the Hungarian product localization in English-facing documentation.
- Add a concise, truthful statement of project ownership, collaborators, and AI coding-assistant usage, based on the author's own records.
