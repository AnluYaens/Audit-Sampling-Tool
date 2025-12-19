import pytest
import json
from app import app, init_storage, db, User

@pytest.fixture
def client():
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-key"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    
    with app.app_context():
        db.create_all()
        yield app.test_client()
        db.session.remove()
        db.drop_all()

def test_validation_limits(client):
    """Test payload size and transaction count limits."""
    # Authenticate first
    email = "limit_test@example.com"
    password = "password123"
    
    # Create user
    client.post("/api/auth/signup", json={
        "name": "Limit Tester",
        "email": email,
        "password": password,
        "confirmPassword": password
    })
    
    # Login
    client.post("/api/auth/login", json={"email": email, "password": password})

    # Test Transaction Limit
    # Create a fake payload with 10001 items
    large_payload = [{"amount": 100} for _ in range(10001)]
    res = client.post("/api/anomaly/score", json={"transactions": large_payload})
    assert res.status_code == 400
    assert "limit exceeded" in res.get_json()["error"]

    # Test Valid Count
    valid_payload = [{"amount": 100} for _ in range(10)]
    res_valid = client.post("/api/anomaly/score", json={"transactions": valid_payload})
    if res_valid.status_code == 400:
        assert "limit exceeded" not in res_valid.get_json().get("error", "")

    if res_valid.status_code == 400:
        assert "limit exceeded" not in res_valid.get_json().get("error", "")

def test_auth_flow(client):
    """Test signup, login, access, and logout."""
    # 1. Signup
    email = "security_test@example.com"
    password = "securepassword123"
    
    # No need to manual cleanup with in-memory DB fixture


    client.post("/api/auth/signup", json={
        "name": "Test User",
        "email": email,
        "password": password,
        "confirmPassword": password
    })

    # 2. Login
    login_res = client.post("/api/auth/login", json={
        "email": email,
        "password": password
    })
    assert login_res.status_code == 200

    # 3. Access Protected Endpoint
    # Should not be 401. Might be 400 (bad request) or 503 (model not loaded), but NOT 401.
    score_res = client.post("/api/anomaly/score", json={"transactions": []})
    assert score_res.status_code != 401

    # 4. Logout
    logout_res = client.post("/api/auth/logout")
    assert logout_res.status_code == 200

    # 5. Access Again (Should be 401)
    score_res_again = client.post("/api/anomaly/score", json={"transactions": []})
    assert score_res_again.status_code == 401
