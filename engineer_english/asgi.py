import os
import django
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "engineer_english.settings")
django.setup()

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        # WebSocket routes can be added later, e.g. for AI chat role‑play
        "websocket": AuthMiddlewareStack(URLRouter([])),
    }
)
