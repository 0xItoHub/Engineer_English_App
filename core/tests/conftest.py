import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from .factories import make_lesson, make_scene, make_user


@pytest.fixture(autouse=True)
def _clear_cache():
    # レート制限のカウンタをテストごとにリセットする
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user():
    return make_user()


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def scene(db):
    return make_scene()


@pytest.fixture
def lesson(scene):
    return make_lesson(scene)
