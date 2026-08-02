from django.middleware.csrf import CsrfViewMiddleware


class ApiCsrfExemptMiddleware(CsrfViewMiddleware):
    """
    Exempts all /api/ routes from CSRF protection.
    Token authentication handles security on API routes.
    /admin/ remains fully CSRF-protected.
    """
    def process_view(self, request, callback, callback_args, callback_kwargs):
        if request.path.startswith('/api/'):
            return None
        return super().process_view(request, callback, callback_args, callback_kwargs)
