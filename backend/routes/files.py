from flask import Blueprint

from backend.response import api_response

files_bp = Blueprint('files', __name__, url_prefix='/api/files')


@files_bp.route('', methods=['GET'])
def list_files():
    return api_response({'message': 'Files and uploads coming soon.'}), 501


@files_bp.route('/upload', methods=['POST'])
def upload_file():
    return api_response({'message': 'File upload coming soon.'}), 501


@files_bp.route('/<file_id>', methods=['GET', 'DELETE'])
def file_detail(file_id):
    return api_response({'message': 'File operations coming soon.'}), 501
