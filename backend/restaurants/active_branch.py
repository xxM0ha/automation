"""Per-request 'active branch' — the branch an owner is currently viewing.

The client sends `X-Branch: <slug>`; ActiveBranchMiddleware stashes it here, and
User.current_restaurant reads it (validated against the user's accessible
branches). This lets every existing view — which already scopes by
`request.user.current_restaurant` — follow the owner's branch selection with no
changes. WSGI sync workers → one thread per request, so a thread-local is safe.
"""
import threading

_state = threading.local()


def set_active_branch(slug):
    _state.slug = (slug or '').strip() or None


def get_active_branch():
    return getattr(_state, 'slug', None)


def clear_active_branch():
    _state.slug = None
