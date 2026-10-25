import pytest

from core.auth import ExternalUser


def test_external_user_is_authenticated():
    user = ExternalUser(sub="sub-alice", username="alice")

    assert user.is_authenticated is True
    assert user.is_anonymous is False
    assert user.pk == "sub-alice"
    assert str(user) == "alice"


def test_external_user_without_username_uses_sub():
    user = ExternalUser(sub="sub-bob")

    assert user.username == ""
    assert str(user) == "sub-bob"


def test_external_user_equality_is_based_on_sub():
    assert ExternalUser(sub="s1", username="a") == ExternalUser(sub="s1", username="b")
    assert ExternalUser(sub="s1") != ExternalUser(sub="s2")
    assert ExternalUser(sub="s1") != "s1"
    assert len({ExternalUser(sub="s1"), ExternalUser(sub="s1")}) == 1


@pytest.mark.parametrize("sub", ["", None])
def test_external_user_requires_sub(sub):
    with pytest.raises(ValueError):
        ExternalUser(sub=sub)
