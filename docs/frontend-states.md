# Frontend state coverage

The app uses one set of state components across the workspace, desk, dialogs,
and startup screens. These states use Inter, the same theme tokens and radii,
and the same brand mark as the rest of the interface.

- `components/Loading.tsx` owns the branded startup screen, inline spinner, and row skeletons.
- `lib/use-request.ts` owns cancellation, loading, refresh, and retry. A previous response cannot replace a newer filter or route request. Workspace identity data stays available during refresh.
- `components/AsyncForm.tsx` locks submissions and disables the full fieldset while a request runs. Inputs survive a failed save.
- `ui.tsx` owns pending action buttons, errors with retry, and empty states.
- `styles/states.css` owns state presentation and reduced-motion behavior.

## Screens

Each route below is exercised with a held request, a failed response, and a
successful retry in both themes. The existing responsive suite also checks the
workspace and desk at phone, tablet, and desktop sizes.

| Surface | States checked |
| --- | --- |
| Startup and session/redirect gate | Branded loading, startup failure and retry, reduced motion |
| Home | All conversations, initial/refresh loading, no bots, no conversations, failure and retry |
| Messages and conversation detail | Loading, empty filter, failure, retry, reply |
| Rooms and room detail | Loading, no rooms/posts, failure and retry |
| Tasks and task detail | Loading, empty list, failure and retry |
| Search and bot profile | Loading, no matches/unavailable bot, failure and retry |
| Activity | Loading, no activity, failure and retry |
| Overview | Loading, failure and retry; pending requests load independently |
| Manage bots | Loading, empty account/search, failure, retry, cancelled stale filters |
| Bot settings | Loading, profile save, webhook save/test, independent reach/snippet errors and retry |
| Mail explorer and thread | Loading, empty results/thread, failure and retry |
| Desk tasks | Loading, empty list, failure and retry |
| Connections, grants and registration requests | Independent loading, empty sections, visible errors and retry, pending decisions |
| API keys | Loading, empty list, creation/revocation pending and failure |
| Audit and deliveries | Loading, empty results, failure and retry |
| Settings | Loading, pending save, preserved input on failure, saved feedback |
| Accounts | Loading, empty list, pending invite/account actions and failure |
| Bind a connection | Loading, pending existing/new-bot binding, preserved input on failure |
| Compose | Destination loading/empty/error, pending send, duplicate-submit guard, saved-message close |
| Mobile navigation | Visible desk bar, sender picker without an active-bot selection |

The browser tests use deterministic API fixtures. Backend tests separately
exercise authorization, account isolation, and message/task behavior. Production
Clerk sign-in needs real provider credentials and is not part of the fixture suite.

Run `npm run test:ui --prefix web` after installing Playwright Chromium, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable.
