# Keyboard accessibility audit

Baseline: `main` at `f62f770b371ce2afd638e94b4c7528e02319a3a5`.

Method: inspect semantics and automated keyboard behavior, then make a
mouse-free pass against the production build. “Exposed” means the state is
available to assistive technology, not only shown through color or placeholder
text.

## Experience map

| Flow / control | Role matches action | Name describes purpose | State exposed | Keyboard | Focus | Error |
| --- | --- | --- | --- | --- | --- | --- |
| Login/register mode | Button group is appropriate for a two-state mode switch | `login` / `register` | `aria-pressed`; disabled while submitting | Tab + Enter/Space | Visible ring; DOM order | n/a |
| Username | Text input | Persistent `username` label | required + invalid | Tab and typing | Visible ring; first invalid target | `aria-describedby` points to field error |
| Passphrase | Password input | Persistent `passphrase` label | required + invalid; correct autocomplete | Tab and typing | Visible ring; first invalid target | `aria-describedby` points to field error |
| Confirm passphrase | Password input | Persistent `confirm passphrase` label | required + invalid; `new-password` autocomplete | Tab and typing | Visible ring; mismatch target | `aria-describedby` points to field error |
| Authentication submit | Submit button | Action changes with mode | disabled and status announced while pending | Enter from fields; Enter/Space on button | Visible ring | Failure summary is an alert and receives focus |
| Unlock passphrase | Password input | Persistent `passphrase` label | required; pending button state | Tab; Enter submits | Visible input/button focus | Existing field error is associated by `Input` |
| Contact | Button inside Conversations list | Username and visible opening text | pressed, disabled, and busy | Tab + Enter/Space | Visible inset ring | Opening failure is a polite visible status |
| Message composer | Multiline textbox | Persistent, visually hidden `Message` label | disabled during reconnect | Tab; Enter sends; Shift+Enter inserts newline | Visible ring | Delivery failure is a polite visible status |
| Send message | Button | `Send message` | disabled when empty or reconnecting | Tab + Enter/Space | Visible ring | Delivery failure remains visible near composer |
| Failed message retry | Button | Includes failed message text | Present only for failed messages | Tab + Enter/Space | Visible ring | Updated delivery state is exposed in the message log |
| Message timeline | Log | `Messages` | Polite additions/text updates; fetch error is a polite status | Reading order follows DOM | No forced focus on new messages | Initial and cached-data failures are visible statuses |
| Connection state | Status | Visible `connected` / `disconnected` text | Polite atomic status | n/a | No disruptive focus move | Reconnecting also describes unavailable sending |
| Keyboard-shortcuts opener | Button | `Keyboard shortcuts` | Dialog open state follows native modal behavior | Tab + Enter/Space | Visible ring | n/a |
| Keyboard-shortcuts dialog | Native modal dialog | Labelled by visible heading | Modal top layer blocks background | Tab/Shift+Tab trapped; Escape closes | Focus enters close button and returns to opener | n/a |
| Dialog close | Button | `Close keyboard shortcuts` | n/a | Tab + Enter/Space; Escape alternative | Initial focus + visible ring | n/a |

## Form decision

`AuthForm` is the keyboard-complete form. It intentionally does **not**
autofocus on first render: stealing focus during route rendering is not needed.
Validation moves focus only after a failed submission. Server/authentication
failure moves focus to an announced summary.

The form uses a synchronous ref guard in addition to the rendered disabled
state, preventing a second submission before React has committed the pending
render. Password fields remain password-manager friendly through
`username`, `current-password`, and `new-password` autocomplete tokens.

## Modal decision

Keyboard-shortcuts help is a real product interaction because the app supports
distinct Enter and Shift+Enter composer behavior and is being made usable
without a pointer. A native `dialog.showModal()` supplies modal semantics and
background inertness in production. Explicit focus cycling makes the expected
Tab behavior testable and guards the boundary. No positive `tabIndex` is used.

## Announcement policy

- **Polite status:** conversation-opening failure, fetch failure, cached-data
  warning, message-delivery failure, and reconnecting. These are important but
  do not justify interrupting the user mid-entry.
- **Alert + focus:** authentication failure. It follows a direct submit action
  and blocks progress.
- **Log:** incoming messages and delivery text changes. Focus is never moved
  when a message arrives.

## Verification

Automated checks cover:

- role and label queries;
- label queries for password inputs;
- logical `userEvent.tab()` order;
- Enter submission and duplicate-submit prevention;
- field/error associations and focus placement;
- modal entry, Tab/Shift+Tab containment, Escape, and focus restoration.

Manual production-build pass:

1. Disconnect/ignore the mouse.
2. Traverse login and registration in both modes.
3. Submit empty and mismatched forms; verify focus and visible errors.
4. Open and close keyboard shortcuts using Enter and Escape.
5. Verify focus remains in the dialog with Tab and Shift+Tab.
6. Select a contact, type a multiline message, send, and retry a failed send.
7. Verify visible focus at every step and no unreachable action.
