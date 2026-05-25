from flask import Blueprint

from backend.routes.v1.analytics import analytics_bp
from backend.routes.v1.inventory import inventory_bp
from backend.routes.v1.scanner import scanner_bp

v1_bp = Blueprint('v1', __name__, url_prefix='/api/v1')
v1_bp.register_blueprint(analytics_bp)
v1_bp.register_blueprint(inventory_bp)
v1_bp.register_blueprint(scanner_bp)
