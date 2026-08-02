from .active_branch import set_active_branch, clear_active_branch


class ActiveBranchMiddleware:
    """Stashes the request's `X-Branch` header so User.current_restaurant can
    scope to the branch the owner selected. Cleared after the response so the
    thread-local never leaks between requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        set_active_branch(request.headers.get('X-Branch'))
        try:
            return self.get_response(request)
        finally:
            clear_active_branch()
