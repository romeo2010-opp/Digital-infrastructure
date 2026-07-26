# SmartLink Team Suite MVP

## Outcome

SmartLink Team Suite is an internal CRM and operations workspace at `/team`. It reuses the SmartLink Schools visual system but has separate navigation, records, identities, sessions, route guards and database access rules.

The implementation is additive. Existing SmartLink Schools routes, school users, tenant tables and school JWTs remain unchanged.

## Repository architecture discovered

- Client: React 18 application built by Vite 6, React Router 7, Tailwind 4, Radix UI primitives, Lucide icons and Recharts.
- Server: Node.js ES modules, Express 4, `mysql2/promise`, raw parameterised SQL, JWT bearer sessions and bcrypt password hashes.
- Database: MySQL with numbered additive SQL migrations in `server/database/`.
- API convention: Express router mounted at `/api`, `asyncHandler` controllers, `HttpError`, central safe error normalisation, server-side role guards and explicit transactions.
- Existing school security: school JWTs carry a tenant and role; school queries are scoped by `school_id`.
- Existing internal audit: school-tenant audit records exist, but are intentionally not reused for company CRM data.
- UI language: Geist typography, CSS variables, compact cards, 6–9px radii, restrained shadows, white operational surfaces, status badges, responsive tables, modal actions, skeleton/loading states and toast infrastructure.
- Testing: Node's built-in test runner for server, workflow and source-contract tests.
- Deployment: separate Railway client and server services; the server has no compile step and the client uses `npm run build`.

## Separation and security model

Team Suite uses its own `team_users` table. A school owner, teacher, parent, learner or other tenant user is not a Team Suite identity.

Team tokens:

- are issued only by `POST /api/team/auth/login`;
- use a derived Team Suite secret (`TEAM_JWT_SECRET`, falling back to a derivation of `JWT_SECRET`);
- require issuer `smartlink-schools-api`;
- require audience `smartlink-team-suite`;
- require the `workspace=team` claim;
- cannot be replaced by a valid SmartLink Schools token;
- are rehydrated from the database on every request so account disabling and role changes take effect immediately.

The client stores the internal session under `smartlink.team.session.v1`, separate from the school portal. `/team` is selected before the school `PortalProvider` is mounted.

Backend assignment rules are authoritative. Users without `SCHOOLS_VIEW_ALL` can only access a school when assigned through the school, an opportunity, onboarding, or support ticket. A cross-assignment ID lookup returns 404 so it does not reveal that a record exists.

There is no update or delete API for `team_audit_logs`.

## Database migration

Migration: `server/database/066_smartlink_team_suite.sql`

It adds:

- `team_roles`
- `team_permissions`
- `team_role_permissions`
- `team_users`
- `team_user_roles`
- `team_school_prospects`
- `team_school_contacts`
- `team_contact_classifications`
- `team_school_relationships`
- `team_sales_opportunities`
- `team_opportunity_stage_history`
- `team_school_activities`
- `team_tasks`
- `team_meetings`
- `team_meeting_participants`
- `team_demo_checklist_items`
- `team_proposals`
- `team_proposal_modules`
- `team_proposal_approvals`
- `team_onboarding_projects`
- `team_onboarding_checklist_items`
- `team_subscriptions`
- `team_support_tickets`
- `team_ticket_comments`
- `team_attachments`
- `team_notifications`
- `team_audit_logs`
- `team_message_templates`

Prospects do not need a tenant in `schools`. `team_school_prospects.tenant_school_id` stays nullable until an authorised future conversion workflow links the signed customer to a live school tenant.

Apply it from the server directory:

```bash
DATABASE_URL="mysql://..." npm run db:apply -- database/066_smartlink_team_suite.sql
```

Do not run the demo seed on a production database. Schema migration 066 is required before starting the server with Team Suite users.

### Rollback guidance

There is deliberately no automated destructive down migration. If the feature must be removed:

1. Disable `/team` at the deployment/router layer.
2. Export all `team_*` tables.
3. Confirm no prospect has been linked through `tenant_school_id` without preserving that conversion map.
4. Drop foreign-key child tables before parents in a scheduled maintenance window.

Removing Team Suite client and server routes is safe for school tenants. Dropping its tables is destructive and must never be performed automatically.

## Role and permission summary

| Role | Main access | Main restrictions |
|---|---|---|
| Platform Owner | Every Team Suite permission, users, settings, audit and approvals | Cannot edit or delete audit history |
| Operations & Partnerships Manager | All school pipelines, assignments, tasks, meetings, late sales, onboarding, support and reports | No role administration, finance confirmation or audit mutation |
| Outreach Officer | Create prospects; manage assigned schools, contacts, activity, early opportunities, tasks and meetings | No discounts, late commercial stage, payment or user management |
| Implementation & Support Officer | Assigned signed customers, onboarding, tasks, meetings, subscriptions view and support | No commercial approval or unrelated prospect access |
| Finance Officer | Proposals, subscriptions, payment confirmation, finance reports and exports | No outreach history mutation, school academic data or user management |
| Developer | Assigned technical support and diagnostic school context | No general customer browsing, opportunity values, discounts or payments |

A user can hold multiple roles. Effective permissions are the union of `team_role_permissions` for every assigned role.

## Client routes

- `/team` → dashboard redirect
- `/team/dashboard`
- `/team/schools`
- `/team/schools/:schoolRef`
- `/team/pipeline`
- `/team/tasks`
- `/team/meetings`
- `/team/proposals`
- `/team/onboarding`
- `/team/subscriptions`
- `/team/support`
- `/team/team-members`
- `/team/reports`
- `/team/audit-log`
- `/team/settings`

## API routes

All paths below are prefixed by `/api/team`.

### Authentication

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/change-password`

### Dashboard and search

- `GET /dashboard`
- `GET /search?q=...&page=...&page_size=...`

### Schools, contacts and activity

- `GET /schools`
- `GET /schools/duplicates`
- `POST /schools`
- `GET /schools/:schoolRef`
- `PATCH /schools/:schoolRef`
- `POST /schools/:schoolRef/contacts`
- `PATCH /schools/:schoolRef/contacts/:contactRef`
- `POST /schools/:schoolRef/relationships`
- `POST /activities`

### Opportunities

- `GET /opportunities`
- `POST /opportunities`
- `GET /opportunities/:opportunityRef`
- `PATCH /opportunities/:opportunityRef`
- `POST /opportunities/:opportunityRef/stage`

### Tasks and meetings

- `GET /tasks`
- `POST /tasks`
- `PATCH /tasks/:taskRef`
- `GET /meetings`
- `POST /meetings`
- `PATCH /meetings/:meetingRef`

### Proposals

- `GET /proposals`
- `POST /proposals`
- `GET /proposals/:proposalRef`
- `POST /proposals/:proposalRef/submit`
- `POST /proposals/:proposalRef/decision`
- `POST /proposals/:proposalRef/sent`

### Onboarding

- `GET /onboarding`
- `POST /onboarding`
- `GET /onboarding/:projectRef`
- `PATCH /onboarding/:projectRef`
- `PATCH /onboarding/:projectRef/checklist/:itemRef`
- `POST /onboarding/:projectRef/go-live`

### Subscriptions and support

- `GET /subscriptions`
- `POST /subscriptions`
- `PATCH /subscriptions/:subscriptionRef`
- `GET /support`
- `POST /support`
- `PATCH /support/:ticketRef`
- `POST /support/:ticketRef/comments`

### Management

- `GET /notifications`
- `POST /notifications/read-all`
- `POST /notifications/:notificationRef/read`
- `GET /team-members`
- `POST /team-members`
- `PATCH /team-members/:userRef`
- `GET /roles`
- `GET /reports`
- `GET /audit-log`

Every list supports a bounded server-side page size. Primary lists support operational filters; global search uses bounded SQL unions and never downloads every record to the browser.

## Workflow controls

- Opportunity movement always appends `team_opportunity_stage_history`.
- Outreach accounts cannot move into late commercial stages.
- Proposal Sent requires an approved structured proposal with price, module, payment-term, recipient and expiry records.
- Contract Signed requires contract evidence, signing date, final price, payment schedule, implementation owner and onboarding date.
- Closed Lost requires a reason.
- Closed Won requires final value, contract evidence, implementation owner and go-live date.
- Onboarding can only be created from Closed Won.
- Onboarding progress is recalculated from checklist rows.
- Go-live requires core checks. An authorised override must contain a reason and is audited.
- A restricted proposal discount creates a pending approval. The requester cannot approve it unless they are Platform Owner.
- Approved discount and final amount are stored explicitly.
- Subscription status calculates renewal, overdue, grace and expiry alerts without changing a live school account.
- Resolved and closed support tickets require a resolution.
- Completed tasks require a completion note and prompt for a follow-up.

## Demonstration seed

The seed is `server/scripts/seed-team-suite.mjs`. It creates 15 fictional schools, six role-specific users, pipeline stages, contacts, a blocker, overdue work, meetings, an approval request, a won and lost deal, onboarding, renewal warning and support tickets.

It does not contain a password or real contact details. To run it on a development database:

```bash
ALLOW_TEAM_DEMO_SEED=true \
TEAM_DEMO_PASSWORD="choose-a-temporary-password" \
DATABASE_URL="mysql://..." \
npm run db:seed:team
```

Seed login emails:

- `owner@team.smartlink.example.test`
- `operations@team.smartlink.example.test`
- `outreach@team.smartlink.example.test`
- `implementation@team.smartlink.example.test`
- `finance@team.smartlink.example.test`
- `developer@team.smartlink.example.test`

All accounts use the password supplied through `TEAM_DEMO_PASSWORD` and must replace it at first login. An idempotent rerun does not reset an existing user's password.

## Test and build commands

```bash
cd smartlink-schools/server
npm test
node --test test/teamSuite.test.js
```

```bash
cd smartlink-schools/client
npm run build
```

## Manual end-to-end checklist

1. Apply migration 066 to a development database.
2. Run the opt-in fictional seed.
3. Open `/team` and verify a school user cannot authenticate.
4. Log in with the Platform Owner seed and replace the temporary password.
5. Create a prospect and verify it appears in search and the dashboard metric links.
6. Add two contacts and classify a decision-maker and champion.
7. Assign the prospect to Outreach.
8. Log a WhatsApp message and next action.
9. Create and assign a follow-up task.
10. Schedule a product demo.
11. Record the demo outcome and next action.
12. Create a proposal with modules, payment terms, recipient and expiry.
13. Request a discount and verify the requester cannot self-approve.
14. Approve as Platform Owner and mark the proposal sent.
15. Move the opportunity to Negotiation.
16. Move to Contract Signed with all evidence fields.
17. Close as Won with final value and expected go-live.
18. Create onboarding and complete checklist items.
19. Confirm that go-live fails while required checks are missing.
20. Complete the checks or record an authorised override; approve go-live.
21. Create a subscription and verify 30/14/7-day renewal status behaviour.
22. Create, assign, resolve and close a support ticket.
23. Review the immutable audit log for login, stage, approval, onboarding and ticket actions.
24. Log in as Outreach, Finance, Implementation and Developer and verify their restricted direct URLs return 403/404.
25. Recheck the normal SmartLink Schools login and main school routes.

## Known MVP limitations and next phase

- Attachment tables and metadata are ready, but binary Team Suite upload/download endpoints are intentionally not included until private object storage and malware scanning are configured.
- WhatsApp is manual: template, copy, mark-sent and response recording. There is no automated sending or scraping.
- Structured proposal data is implemented; document generation is not.
- Subscription status does not suspend or make any live school tenant read-only.
- Prospect-to-tenant conversion is represented by a nullable relationship; provisioning a live tenant remains an explicit future workflow.
- Notification creation is event-driven for core actions. A scheduled worker should later add due-soon, inactivity and renewal reminders.
- Advanced accounting, payroll, AI scoring, marketing automation and source-control operations remain out of scope.

Recommended next phase: private attachment storage, scheduled reminder worker, explicit prospect-to-tenant provisioning approval, richer proposal document export, notification preferences and end-to-end browser tests against a disposable MySQL database.
