from flask import Blueprint

from backend.routes.v1.analytics import analytics_bp

v1_bp = Blueprint('v1', __name__, url_prefix='/api/v1')
v1_bp.register_blueprint(analytics_bp)
