from flask import Flask
from config import Config
from .extensions import db, login_manager, limiter, compress
from .models import User

def create_app(config_class=Config):
    # Creamos la instacia de flask y le decimos donde esta el frontend
    app = Flask(__name__,
                template_folder="../frontend/templates",
                static_folder="../frontend/static")

    # Cargamos la configuracion desde config_class
    app.config.from_object(config_class)
    
    # Conectamos las extensiones a esta app especifica
    db.init_app(app)
    login_manager.init_app(app)
    limiter.init_app(app)
    compress.init_app(app)
    
    # Configuracion del login
    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))
    
    @login_manager.request_loader
    def load_user_from_request(request):
        """Support token-based auth for clients that can't use cookies."""
        auth_header = request.headers.get("Authorization")
        if auth_header:
            try:
                # Import serializer logic here or use itsdangerous directly
                from itsdangerous import URLSafeTimedSerializer
                s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
                token = auth_header.replace("Bearer ", "", 1)
                user_id = s.loads(token, max_age=86400)
                return db.session.get(User, int(user_id))
            except Exception:
                return None
        return None

    from backend.api.auth import auth_bp
    app.register_blueprint(auth_bp)

    from backend.api.anomaly import anomaly_bp
    app.register_blueprint(anomaly_bp)

    
    # Aseguramos que el directorio db existe para SQLite
    import os
    db_path = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if db_path.startswith("sqlite:///"):
        # Remove sqlite:/// prefix and get parent dir
        path = db_path.replace("sqlite:///", "")
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

    # Crear tablas si no existen (lo haciamos en init_storage antes)
    with app.app_context():
        db.create_all()

    @app.after_request
    def add_cors_headers(response):
        """Allow local static pages (file://) to call the API."""
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return response

    # Rutas de sistemas y errores
    @app.route("/api/health", methods=["GET"])
    def healthcheck():
        return {"status": "ok"}
    
    @app.errorhandler(413)
    def request_entity_too_large(error):
        return {"error": "File is too large. Maximum size is 16MB"}, 413
    
    # Servir Frontend
    @app.route("/")
    def serve_index():
        return app.send_static_file("index.html")

    @app.route("/<path:path>")
    def serve_static(path):
        try:
            return app.send_static_file(path)
        except:
            return app.send_static_file("index.html")
    
    return app