class PrivateResponseMiddleware:
    """Avoid logging OAuth query strings and caching private API responses."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        private = scope["path"].startswith(("/api/auth/", "/api/admin/", "/api/account/", "/api/runs/", "/api/simulate", "/api/analyze"))

        async def secured_send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend([(b"referrer-policy", b"no-referrer"), (b"x-content-type-options", b"nosniff")])
                if private:
                    # Uvicorn's access log reads scope when the response starts.
                    scope["query_string"] = b""
                    headers.extend([(b"cache-control", b"no-store, private"), (b"x-robots-tag", b"noindex, nofollow")])
                message["headers"] = headers
            await send(message)
        await self.app(scope, receive, secured_send)
