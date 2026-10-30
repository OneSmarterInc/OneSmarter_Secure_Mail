import uuid

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.sessions.middleware import SessionMiddleware
from django.http import JsonResponse
from django.utils import timezone

from .company_identity import is_company_address
from .models import StaffUser


class PortalSessionMiddleware(SessionMiddleware):
    """Recipient API sessions cannot inherit a staff login, even on one host."""

    def process_request(self, request):
        request.recipient_portal = request.path.startswith("/recipient-api/")
        cookie = "recipient_sessionid" if request.recipient_portal else settings.SESSION_COOKIE_NAME
        request.session = self.SessionStore(request.COOKIES.get(cookie))

    def process_response(self, request, response):
        response = super().process_response(request, response)
        if getattr(request, "recipient_portal", False):
            name = settings.SESSION_COOKIE_NAME
            if name in response.cookies:
                original = response.cookies.pop(name)
                response.cookies["recipient_sessionid"] = original.value
                for key, value in original.items():
                    response.cookies["recipient_sessionid"][key] = value
                response.cookies["recipient_sessionid"]["path"] = "/recipient-api/"
        return response


class SecurityContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        if request.path.startswith("/api/recipient/") and not settings.ENABLE_LEGACY_RECIPIENT_API:
            response = JsonResponse(
                {"error": {"message": "Not found.", "code": "not_found"}}, status=404
            )
            response["Cache-Control"] = "no-store"
            return response
        if request.user.is_authenticated:
            if (
                request.user.status != "active"
                or not is_company_address(request.user.email)
                or request.session.get("staff_version") != request.user.session_version
            ):
                logout(request)
            elif request.method not in {"GET", "HEAD", "OPTIONS"}:
                StaffUser.objects.filter(pk=request.user.pk).update(last_activity=timezone.now())
        response = self.get_response(request)
        if request.path.startswith(("/api/", "/recipient-api/")):
            response["X-Request-ID"] = request.request_id
            response["Cache-Control"] = "no-store"
            response["Pragma"] = "no-cache"
            response["X-Content-Type-Options"] = "nosniff"
            response["Referrer-Policy"] = "no-referrer"
        return response
